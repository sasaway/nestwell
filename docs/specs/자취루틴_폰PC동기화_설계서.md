# 자취루틴 × ~/life 동기화 설계

작성일: 2026-09-18 · 상태: 승인됨(브레인스토밍) · 다음 단계: 구현 계획

## 1. 목적

1. 자취루틴 앱(v6)에 입력하는 모든 데이터(식단·운동·돈·설정·회고)가 `~/life` 에 기록으로 남는다.
2. 폰과 PC에서 같은 앱·같은 데이터를 쓴다. 폰은 집 밖(헬스장·직장)에서도 입력한다.
3. 매일 밤 입력 데이터로 회고를 기록하고 `~/life` 를 자동 정리한다.

## 2. 전제와 제약

- Mac은 노트북이다. 낮에는 들고 다니거나 꺼 둔다 → Mac을 서버로 쓰지 않는다.
- `~/life/docs/` 에는 밖으로 나가도 괜찮은 자료만 넣는다(사용자 결정, 2026-09-18). 그래서 `~/life` 전체를 비공개 GitHub 저장소로 둔다.
- 원본 앱: `~/Downloads/자취루틴_통합앱_v6.html` (단일 HTML, 저장은 `DB.get/set/del` 한 곳을 거친다).
- 사용자 GitHub 계정: `sasaway` (gh 로그인 확인됨).

## 3. 구조

```
[폰 / PC 브라우저] ─> 자취루틴 웹앱 (공개 저장소 jachwi-routine → GitHub Pages, 코드만)
        │ 입력 시 GitHub Contents API 로 app/ 아래에 커밋
        ▼
비공개 저장소 life  ⇄  Mac 의 ~/life (git clone)
        ▲
        └── 밤 작업(launchd 23:30): pull → 회고 내보내기 · 분류 · 다음날 준비 → commit · push
```

| 저장소 | 공개 | 담는 것 |
|---|---|---|
| `sasaway/jachwi-routine` | 공개 (무료 Pages 조건) | 앱 코드만. 데이터·토큰 없음 |
| `sasaway/life` | 비공개 | `~/life` 전체. 앱은 `app/` 아래만 쓴다 |

**쓰기 영역 분리**: 앱은 `app/**` 만, 밤 작업과 스킬은 `app/` 밖만 쓴다. 같은 파일을 두 쪽이 쓰지 않는다.

**저장소에서 뺄 것(.gitignore)**: `inbox/mail/`(제3자 개인정보), `tools/nightly.log`, `__pycache__/`, `.DS_Store`.

### 토큰
- fine-grained PAT, 대상 저장소 `sasaway/life` 하나, 권한 `Contents: Read and write` 만. 만료 1년.
- 기기마다 앱 첫 실행 때 한 번 입력 → 그 브라우저의 `localStorage` 에만 저장. 코드·저장소에 넣지 않는다.
- 분실 시 GitHub 에서 토큰 폐기 → 피해 범위는 `life` 저장소 하나.

## 4. 데이터 파일

v6 저장 키 ↔ 저장소 경로를 1:1로 맞춘다. JSON, 2칸 들여쓰기, 끝에 줄바꿈.

| v6 키 | 경로 | 병합 단위 |
|---|---|---|
| `living-routine:v1:settings` | `app/settings.json` | 파일 전체(마지막 저장 우선) |
| `living-routine:v1:meals:YYYY-MM` | `app/meals/YYYY-MM.json` | 날짜 키 |
| `living-routine:v1:workouts:YYYY-MM` | `app/workouts/YYYY-MM.json` | 날짜 키 |
| `living-routine:v1:budget:YYYY-MM` | `app/budget/YYYY-MM.json` | 파일 전체(마지막 저장 우선) |
| `living-routine:v1:review:YYYY-MM` (신규) | `app/review/YYYY-MM.json` | 날짜 키 |

회고 한 날의 모양:

```json
{
  "2026-09-18": {
    "good": "제안서 끝냄",
    "bad": "없음",
    "learned": "메일은 점심 뒤로",
    "tomorrow": "2분기 계획 검토",
    "savedAt": "2026-09-18T23:02:11+09:00"
  }
}
```

회고는 **그 날짜 자정까지만** 고칠 수 있다. 지난 날짜는 앱에서 읽기 전용이다. 밤 작업은 `app/` 을 읽기만 하고 쓰지 않는다.

## 5. 앱 저장 계층 (`DB` 교체)

`DB.get/set/del` 의 겉모양(이름·인자·async)은 그대로 둔다. 화면·계산 코드는 바꾸지 않는다.

- **get(key)**: `localStorage` 캐시를 즉시 반환. 동시에 원격을 받아 캐시와 다르면 갱신 후 `render()`. 앱이 다시 보일 때(`visibilitychange`)도 원격을 다시 받는다.
- **set(key, val)**: 캐시에 저장 + 전송 대기열에 `{path, dirtyKeys}` 추가(날짜 키 파일은 바뀐 날짜만 기록). 마지막 입력 3초 뒤 파일별로 커밋 한 번.
- **전송**: `GET contents/{path}` 로 sha 확보 → `PUT` (content base64, sha, message). 409/422(sha 불일치) → 원격 최신을 받아 병합 → 재시도 최대 3회. 3회 실패 시 대기열에 남기고 다음 기회에.
- **병합**: 날짜 키 파일은 `원격 ∪ 로컬`, 이번에 고친 날짜(`dirtyKeys`)만 로컬 우선. 전체 단위 파일은 로컬 우선.
- **오프라인**: 대기열을 `localStorage` 에 보존. `online` 이벤트·앱 열기·보이기 전환 때 전송. 헤더에 `동기화 대기 N` 표시, 비면 숨김.
- **커밋 메시지**: `{기능} {날짜 또는 월} · {기기}` 예) `meals 2026-09-18 · 폰`. 기기 이름은 토큰 입력 때 함께 받는다.
- **토큰 없음 / 401**: 앱은 로컬로만 동작하고 헤더에 `동기화 꺼짐` → 눌러서 토큰 입력.
- v3 1회성 초기화(`migrateWorkReset`)는 삭제한다. 이미 끝난 작업이고, 새 기기에서 원격을 받기 전에 돌면 운동 기록을 지운 채 올릴 위험이 있다.

## 6. 오늘 회고 화면

- 하단 탭 4개 유지. 진입점: `+ 기록` 시트의 "오늘 회고", 그리고 21:00 이후 미작성이면 홈 맨 아래 작은 카드.
- 질문 네 개 고정, 한 화면에 하나: 잘된 것 / 안 된 것 / 배운 것 / 내일 첫 번째. 각 화면에 "없음" 버튼. 되묻기 없음.
- 입력은 그대로 저장한다(다듬지 않는다). 그 날짜 자정이 지나면 읽기 전용.

## 7. 밤 작업

`~/Library/LaunchAgents/kr.life.nightly.plist` — `StartCalendarInterval` 23:30. 잠든 동안 놓치면 깨어날 때 한 번 실행된다. 전원이 꺼져 놓친 날은 다음 실행이 밀린 날짜를 모두 처리한다(아래 단계가 전부 멱등).

`~/life/tools/nightly.sh`:

1. `git pull --rebase` — 충돌 시 `git rebase --abort`, 로그, macOS 알림(`osascript`) 후 종료.
2. `python3 tools/export_review.py` — `app/review/*.json` 을 읽어 `review/YYYY-MM-DD.md` 를 쓴다(review-agent 형식, 답 원문 그대로, 빈 답은 `- 없음`).
   - **오늘·어제** 날짜는 매번 다시 쓴다(아직 고칠 수 있었던 날이라 23:30 뒤에 쓴 내용까지 반영).
   - **그보다 오래된** 날짜는 파일이 없을 때만 쓴다(지난 기록을 고치지 않는다).
   - 미래 날짜는 무시한다.
3. 일요일에만: `claude -p "이번 주 정리해줘"` (review-agent → `review/_week/YYYY-Www.md`). `claude` 가 없거나 실패하면 이 단계만 건너뛰고 로그.
4. `python3 tools/sort_drop.py` → `python3 tools/gen_routine.py --date <내일>`.
   `gen_routine.py` 에 v6 근무 시간 반영: 오픈 08:30–15:30, 마감 15:00–22:00 (휴무일 제외).
5. 변경이 있으면 `git add -A && git commit -m "nightly YYYY-MM-DD" && git push`. push 실패는 로그만(다음 밤에 함께 올라간다).

모든 단계 결과는 `tools/nightly.log` 에 한 줄씩 남긴다.

## 8. 오류 처리 요약

| 상황 | 동작 |
|---|---|
| 앱 오프라인 | 로컬 저장 + 대기열, 복귀 시 전송 |
| 폰·PC 동시 수정 | sha 불일치 → 병합 → 재시도(최대 3) |
| 토큰 만료·폐기 | `동기화 꺼짐` 표시, 로컬 동작 유지 |
| 밤 pull 충돌 | 중단 + 알림, 자동 수정 안 함 |
| 밤 push 실패 | 로컬 커밋 유지, 다음 밤 재시도 |
| Mac 잠듦 / 꺼짐 | 깨어날 때 실행 / 다음 실행이 밀린 날짜 처리 |

## 9. 테스트

- **동기화 모듈** (`node --test`, 의존성 없음): 가짜 Contents API 로 ① 날짜 키 병합 ② sha 불일치 재시도 ③ 3회 실패 후 대기열 보존 ④ 오프라인 대기열이 새로고침 후에도 남음 ⑤ 커밋 메시지 형식.
- **export_review.py** (`python3 -m unittest`): ① 원문 보존 ② 오늘·어제는 다시 쓰고 그 이전 기존 파일은 건너뜀 ③ 빈 답 → `없음` ④ 미래 날짜 무시.
- **앱 회고 화면**: 지난 날짜가 읽기 전용인지.
- **종단 확인**: 폰에서 식단 체크 + 회고 입력 → `sasaway/life` 에 커밋 확인 → Mac 에서 `nightly.sh` 수동 실행 → `review/` · `inbox/` 결과 확인.

## 10. 사용자가 직접 할 일

1. 저장소 생성(gh 로 대신 가능 — 실행 전 확인): `jachwi-routine`(공개), `life`(비공개)
2. `jachwi-routine` 의 GitHub Pages 켜기
3. fine-grained PAT 발급(3장 조건)
4. 폰·PC 에서 앱 첫 실행 때 토큰·기기 이름 입력
5. launchd 등록 승인(설치 명령은 구현 때 안내)

## 11. 넣지 않는 것

실시간 동기화, 로그인 화면, 은행·캘린더 연동, 앱 안 AI 기능, `review-agent` 되묻기의 앱 구현.
