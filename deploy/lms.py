#!/usr/bin/python3
"""Read the bot's saved assignments without changing its database."""

import argparse
from contextlib import closing
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import sqlite3
import sys


DEFAULT_DATABASE = Path("/var/lib/lms-bot/lms.sqlite")
JST = timezone(timedelta(hours=9), "JST")


def clean(value):
    return "".join(char if char.isprintable() else " " for char in str(value))


def local_time(value):
    if isinstance(value, (int, float)):
        date = datetime.fromtimestamp(value, JST)
    else:
        date = datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(JST)
    return date.strftime("%Y-%m-%d %H:%M JST")


def open_database(path, arguments):
    try:
        # Directory access does not imply permission to read the database file.
        with path.open("rb"):
            pass
    except PermissionError:
        # Read as the service account; never broaden database permissions.
        if path != DEFAULT_DATABASE:
            raise
        import pwd

        if os.geteuid() == pwd.getpwnam("lms-bot").pw_uid:
            raise
        source = Path(__file__).read_text(encoding="utf-8")
        os.execv(
            "/usr/bin/sudo",
            ["sudo", "-u", "lms-bot", "--", "/usr/bin/python3", "-c", source, *arguments],
        )
    return sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=5)


def main():
    parser = argparse.ArgumentParser(
        prog="lms", description="保存済みの課題を締切順・日本時間で表示します。"
    )
    parser.add_argument("--all", action="store_true", help="期限切れを含む有効な課題を表示")
    parser.add_argument("--json", action="store_true", help="JSON形式で出力")
    parser.add_argument(
        "--database", type=Path, default=DEFAULT_DATABASE, metavar="PATH",
        help="別のSQLiteファイルを読む（既定: /var/lib/lms-bot/lms.sqlite）",
    )
    args = parser.parse_args()
    now = int(datetime.now(timezone.utc).timestamp())
    try:
        with closing(open_database(args.database, sys.argv[1:])) as database:
            database.row_factory = sqlite3.Row
            database.execute("PRAGMA query_only = ON")
            database.execute("BEGIN")
            rows = database.execute(
                "SELECT source, event_id, course_name, course_name_ja, title, "
                "deadline_unix, deadline_iso, url FROM assignments "
                "WHERE is_active = 1 AND (? = 1 OR deadline_unix >= ?) "
                "ORDER BY deadline_unix, source, event_id",
                (int(args.all), now),
            ).fetchall()
            sync = database.execute(
                "SELECT synced_at FROM sync_runs ORDER BY id DESC LIMIT 1"
            ).fetchone()
    except (OSError, sqlite3.Error) as error:
        print("課題を読み込めませんでした: " + clean(error), file=sys.stderr)
        return 1

    assignments = [dict(row) for row in rows]
    if args.json:
        print(json.dumps(assignments, ensure_ascii=False, indent=2))
        return 0

    if sync:
        print("最終同期: " + local_time(sync["synced_at"]))
    else:
        print("最終同期: まだ同期されていません")
    label = "期限切れを含む有効な課題" if args.all else "これから締切を迎える課題"
    print(f"{label}: {len(assignments)}件")
    for index, assignment in enumerate(assignments, 1):
        course = assignment["course_name_ja"] or assignment["course_name"]
        overdue = " [期限切れ]" if assignment["deadline_unix"] < now else ""
        print(f"\n{index}. {clean(assignment['title'])}")
        print("   授業: " + clean(course))
        print("   締切: " + local_time(assignment["deadline_unix"]) + overdue)
        print("   " + clean(assignment["url"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
