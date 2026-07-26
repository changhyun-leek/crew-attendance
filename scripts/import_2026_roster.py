"""2026 교적부를 로컬에서 읽고 이름/크루/본인확인 해시 준비값만 서버로 이관한다.

개인정보 보호 원칙:
- PDF 원문과 휴대폰 번호를 파일/로그/콘솔에 출력하지 않는다.
- 서버에는 TLS로 휴대폰 마지막 4자리만 전달하며, 서버가 즉시 HMAC으로 바꾼다.
- 생년월일, 주소, 학교, 부모 정보, 비고는 읽거나 전송하지 않는다.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import urllib.error
import urllib.request

import pdfplumber

FUNCTION_URL = "https://zzavmguguvuqgdblmkcj.supabase.co/functions/v1/crew-api"
PUBLISHABLE_KEY = "sb_publishable_VY0sNxSFQgHMSItmR5q5pw_4tpdrxWb"
SOURCE_KEY = "2026-youth-register-v260118-kimyujin-override-v1"
ROSTER_PAGES = (0, 1, 2, 5, 6)


def normalized(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("\n", " ")).strip()


def phone_last4(value: object) -> str:
    digits = re.sub(r"\D", "", normalized(value))
    if len(digits) < 4:
        raise ValueError("교사 본인 확인 자료가 비어 있습니다.")
    return digits[-4:]


def extract(pdf_path: str) -> tuple[list[dict], list[dict]]:
    teachers: list[dict] = []
    crews: list[dict] = []
    teacher_by_name: dict[str, dict] = {}

    with pdfplumber.open(pdf_path) as pdf:
        active_header: dict[str, int] | None = None
        active_crew: dict | None = None
        for page_index in ROSTER_PAGES:
            tables = pdf.pages[page_index].extract_tables()
            if not tables:
                continue
            for raw_row in tables[0]:
                row = [normalized(cell) for cell in raw_row]
                if "26년 크루" in row and "이름" in row:
                    active_header = {name: row.index(name) for name in ("26년 크루", "이름", "핸드폰")}
                    continue
                if not active_header or len(row) <= max(active_header.values()):
                    continue
                crew_name = row[active_header["26년 크루"]]
                name = row[active_header["이름"]]
                if not crew_name.endswith("크루") or not name:
                    continue
                if active_crew is None or active_crew["name"] != crew_name:
                    teacher = {"name": name, "role": "teacher", "phoneLast4": phone_last4(row[active_header["핸드폰"]])}
                    teacher_by_name[name] = teacher
                    active_crew = {"name": crew_name, "teacherName": name, "students": []}
                    crews.append(active_crew)
                else:
                    active_crew["students"].append(name)

        teacher_table = pdf.pages[7].extract_tables()[0]
        teacher_header: dict[str, int] | None = None
        for raw_row in teacher_table:
            row = [normalized(cell) for cell in raw_row]
            if "26년 교사" in row and "이름" in row:
                teacher_header = {name: row.index(name) for name in ("26년 교사", "이름", "핸드폰")}
                continue
            if not teacher_header or len(row) <= max(teacher_header.values()):
                continue
            job = row[teacher_header["26년 교사"]]
            name = row[teacher_header["이름"]]
            if not name:
                continue
            role = "executive" if job in {"전도사", "간사", "부장", "부감", "총무/마하나임"} else "teacher"
            teacher_by_name[name] = {"name": name, "role": role, "phoneLast4": phone_last4(row[teacher_header["핸드폰"]])}

        new_family_table = pdf.pages[8].extract_tables()[0]
        new_family_names = []
        for raw_row in new_family_table:
            row = [normalized(cell) for cell in raw_row]
            if row and row[0] == "새가족" and len(row) > 1 and row[1]:
                new_family_names.append(row[1])

    if "김유진" not in teacher_by_name:
        raise ValueError("새 담당교사 김유진 계정을 교사 명단에서 찾지 못했습니다.")
    for crew in crews:
        if crew["name"] == "구예영크루":
            crew["teacherName"] = "김유진"
    if new_family_names:
        crews.append({"name": "새가족", "students": new_family_names})

    teachers = list(teacher_by_name.values())
    regular_crews = [crew for crew in crews if crew["name"] != "새가족"]
    regular_students = sum(len(crew["students"]) for crew in regular_crews)
    if len(teachers) != 34 or len(regular_crews) != 22 or regular_students != 136 or len(new_family_names) != 1:
        raise ValueError("교적부 검증 수가 예상과 달라 이관을 중단했습니다.")
    return teachers, crews


def main() -> None:
    parser = argparse.ArgumentParser(description="새벽이슬 2026 교적부 안전 이관")
    parser.add_argument("pdf", help="교적부 PDF 경로")
    args = parser.parse_args()
    token = os.environ.get("CREW_ADMIN_ACCESS_TOKEN", "").strip()
    if not token:
        raise SystemExit("CREW_ADMIN_ACCESS_TOKEN 환경변수에 임원 로그인 토큰이 필요합니다.")

    teachers, crews = extract(args.pdf)
    body = json.dumps({"action": "admin-import-roster", "sourceKey": SOURCE_KEY, "operatingYear": 2026, "teachers": teachers, "crews": crews}, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(FUNCTION_URL, data=body, method="POST", headers={
        "Authorization": f"Bearer {token}",
        "apikey": PUBLISHABLE_KEY,
        "Content-Type": "application/json; charset=utf-8",
    })
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        try:
            message = json.loads(error.read().decode("utf-8")).get("error", "서버 이관 요청 실패")
        except Exception:
            message = "서버 이관 요청 실패"
        raise SystemExit(message) from None
    safe_keys = ("alreadyImported", "teachersCreated", "crewsCreated", "membershipsCreated", "studentsRenamed", "assignmentsChanged")
    print(json.dumps({key: result.get(key) for key in safe_keys}, ensure_ascii=False))


if __name__ == "__main__":
    main()
