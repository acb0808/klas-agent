# KLAS 리서치 & 제공 기능 목록 (2026-10-28)

조사 방법: (1) 로그인 페이지 스크립트 분석 (2) 사용자가 직접 로그인한 브라우저에서 조회 화면만 열어 XHR 관찰 + 같은 요청을 재현해 **응답 필드 이름만** 확인 (3) 공개 오픈소스 코드 읽기 — `IceCream0910/kw-klas-plus`(KLAS+ 앱), `IceCream0910/kw-klas-plus-webview`, `goonbam0306/klax`(MCP), `snowing152/klas_notification_bot`, `kw-service/klas-helper-extension`(KLAS Helper 확장).

검증 표기: **검증** = 라이브 응답 구조 확인 / **관찰** = 화면이 호출하는 것만 확인 / **추정** = 타 오픈소스 코드 근거, 구현 때 확인 필요
위험 표기: ✅ 순수 조회 / ⚠️ 부수효과 있음(조회수·열람기록) / ⛔ 절대 호출 금지

## 1. KLAS 구조 핵심

- 서버: `https://klas.kw.ac.kr`, 세션 쿠키 `SESSION`(`.kw.ac.kr`, HttpOnly).
- 화면은 `...Page.do`(GET HTML, Vue), 데이터는 `...List.do / Info.do / One.do / Data.do`(**POST + JSON 본문**).
- **조회도 POST** → HTTP 메서드로 읽기 전용을 보장할 수 없음. **엔드포인트 화이트리스트**로만 강제해야 함. (KLAS+도 "모든 POST는 잠재적 쓰기"로 취급하고 자동 재시도하지 않음)
- 공통 요청 컨텍스트: `{ selectYearhakgi: "2026,2", selectSubj: "U{년도}{학기}{과목번호}{개설학과}{분반}{학년}", selectChangeYn: "Y" }`. 과목 코드는 `YearhakgiAtnlcSbjectList.do`에서 얻음.
- 필수 헤더: `Content-Type: application/json`, `X-Requested-With: XMLHttpRequest`.

## 2. 로그인 흐름 (검증)

0. `GET /usr/cmn/login/LoginForm.do` (KLAS+가 먼저 호출해 초기 쿠키를 받음)
1. `POST /usr/cmn/login/LoginSecurity.do` → `{ publicKey }` (헤더 없는 base64 DER → PEM으로 감싸서 사용)
2. `{"loginId","loginPwd","storeIdYn":"N"}` JSON을 RSA(PKCS#1 v1.5, JSEncrypt)로 암호화 → `loginToken` (Node 24 `crypto.publicEncrypt` + `RSA_PKCS1_PADDING` 동작 확인)
3. `POST /usr/cmn/login/LoginCaptcha.do {loginToken, captcha:""}` → 최근 실패 횟수(숫자). **2 초과면 캡차 필요**
4. `POST /usr/cmn/login/LoginConfirm.do {loginToken, captcha, redirectUrl:"", redirectTabUrl:""}` → `errorCount==0`이면 성공, `SESSION` 쿠키 획득
5. 응답 분기: `certOpt`/`frstPwdAt`=Y(임시 비밀번호 변경 필요), `twoFactorAt`=Y(2차 인증), `gradAt`=Y(졸업생 이용 불가)

**비밀번호 5회 오류 시 로그인 제한** → 스킬은 로그인 실패 시 절대 자동 재시도하지 않음. 캡차·2차 인증·해외 IP 추가 인증은 "사용자가 웹에서 직접 해결" 안내로 처리.

## 3. KLAS+ 등 선행 프로젝트에서 얻은 교훈

| 문제 | KLAS+의 대응 | 우리 스킬 적용 |
|---|---|---|
| 조회 API가 전부 POST | 모든 POST를 잠재적 쓰기로 보고 재시도 금지 | 화이트리스트 + 쓰기 엔드포인트 하드 차단 |
| 캡차 / 2차 인증 / 해외 IP 추가 인증 / 임시 비번 | 자동 처리하지 않고 "사용자 조치"로 분리 | 동일. 에이전트에 사유만 반환 |
| 세션 만료 | 서버가 만료를 명시할 때만 세션 삭제, 네트워크 오류로는 지우지 않음 | 동일. 만료 감지 시 1회만 재로그인 |
| 비밀번호 보관 | 평문 저장 금지 (Keystore/Keychain) | `.env`에서 스크립트만 읽음. 에이전트·로그에 노출 금지 |
| AI 에이전트의 쓰기 | 쓰기 도구는 UI 승인 후 실행 | 쓰기 도구 자체를 만들지 않음 |
| klax(MCP)는 헤드리스 Chromium 사용 | — | 불필요. KLAS+가 순수 HTTP 로그인으로 동작함을 증명 |
| KLAS Helper(확장): 과목별 마감 집계 | 영상: `evltnSe=='lesson' && prog<100 && isonoff!='OFF'`, 마감 `endDate`. 과제: `submityn!='Y'`, 마감 `expiredate` 지나면 추가 제출 기한 `reexpiredate` | `todo` 계산 규칙으로 그대로 사용 |
| KLAS Helper(확장): 영상 인증 우회·영상 다운로드 | `CertiStdCheck.do` 우회, 뷰어 `LctreCntntsViewSpvPage.do` | ⛔ 금지 목록에 추가 (학습 인증 우회는 학칙 위반 소지) |

## 4. 제공 기능 목록

명령은 하나의 CLI(`klas <명령>`)로 제공하고, 출력은 에이전트가 읽기 좋은 JSON.

### A. 학적·기본

| 명령 | 내용 | KLAS 메뉴 | 엔드포인트 | 검증 | 위험 |
|---|---|---|---|---|---|
| `profile` | 학과, 학년, 학적상태, 지도교수, 편입학 인정학점(`cultureHakjum`·`majorHakjum`·`generalHakjum`은 **취득학점 아님**) | 수강/성적 조회 | `/std/cps/inqire/AtnlcScreHakjukInfo.do` | 검증 | ✅ |
| `semesters` | 학기 목록 + 학기별 수강과목·과목코드 | 공통 | `/std/cmn/frame/YearhakgiAtnlcSbjectList.do` | 검증 | ✅ |
| `advisor` | 책임지도교수 연락처·연구실·상담시간 | 홈 | `/std/cmn/frame/StdHome.do` (`rspnsblProfsr`) | 검증 | ✅ |

### B. 수업

| 명령 | 내용 | KLAS 메뉴 | 엔드포인트 | 검증 | 위험 |
|---|---|---|---|---|---|
| `courses` | 이번 학기 과목, 교수, 요일·교시, 강의실, 과목별 최근 알림 | 홈 | `StdHome.do` (`atnlcSbjectList`, `subjNotiList`) | 검증 | ✅ |
| `timetable` | 주간 시간표 | 수업시간표 | `/std/cps/atnlc/TimetableStdList.do`, `AtnlcYearList.do` | 검증/관찰 | ✅ |
| `course <과목>` | 강의 홈 요약: 공지 최신, 과제 최신, 출석, 영상 진도, 과제·퀴즈·시험·토론·자료 건수 | 강의종합 | `/std/lis/evltn/LctrumHomeStdInfo.do` | 검증 | ✅ |
| `syllabus <과목>` | 강의계획서: 개요·목표, **평가 비율(중간/기말/출석/과제/퀴즈/발표)**, **1~16주 주차별 계획**, 교재, 수업시간·장소, 학습성과, 선수과목 | 강의계획서 조회 | `/std/cps/atnlc/LectrePlanData.do`, `LectreTimeInfo.do`, `LectrePlanInputTabFourgrid.do`, `LectreBeforeGwamok.do` | 검증 | ✅ |
| `syllabus-search` | 다른 과목 강의계획서 검색(학과·교수·과목명) | 강의계획서 조회 | `LectrePlanStdList.do`, `CmmnHakgwaList.do`, `CmmnGamokList.do`, `CmmnMagerCodeList.do` | 검증/관찰 | ✅ |

### C. 해야 할 일 (과제·영상·퀴즈·시험)

| 명령 | 내용 | KLAS 메뉴 | 엔드포인트 | 검증 | 위험 |
|---|---|---|---|---|---|
| `todo` | 전 과목 미제출 과제 + 미완료 영상 + 진행 중 퀴즈/시험을 마감순으로 | (합성) | 아래 목록들을 과목별로 조회 | — | ✅ |
| `assignments [과목]` | 과제 제목, 기간, 제출 여부, 재제출 기간, 점수 | 과제제출 | `/std/lis/evltn/TaskStdList.do` | 검증 | ✅ |
| `assignment <과목> <번호>` | 과제 지문·첨부 | 과제제출 상세 | `TaskStdView.do` | 추정 | ✅ (제출 화면 아님) |
| `videos [과목]` | 주차별 영상 제목, 수강 기간, **진도율**, 학습/인정 시간 | 온라인 강의컨텐츠 / 진도현황 | `/std/lis/evltn/SelectOnlineCntntsStdList.do` | 검증 | ✅ 목록만 |
| `quizzes [과목]` | 수시퀴즈 목록·기간 | 수시퀴즈 | `/std/lis/evltn/AnytmQuizStdList.do` | 검증 | ✅ |
| `exams [과목]` | 온라인 시험 목록·기간 | 온라인시험 | `/std/lis/evltn/OnlineTestStdList.do` | 검증 | ✅ |
| `projects`, `discussions` | 팀프로젝트·토론 목록 | 팀프로젝트 / 토론참여 | `PrjctStdList.do`, `DscsnStdList.do` | 추정 | ✅ |

### D. 출석·성적

| 명령 | 내용 | KLAS 메뉴 | 엔드포인트 | 검증 | 위험 |
|---|---|---|---|---|---|
| `attendance [과목]` | 주차·차시별 출결, 출석률 계산 | 학습현황 조회 | `/std/lis/evltn/LrnSttusStdAtendList.do` (+`LctrumHomeStdInfo.atendSubList`) | 검증 (출결 코드 의미는 구현 시 매핑) | ✅ |
| `attendance --kw` | KW출첵(전자출결) 과목별 출석 | 출석관리(KW출첵) | `/std/ads/admst/KwAttendStdGwakmokList.do`, `KwAttendStdAttendList.do` | 검증/추정 | ✅ |
| `grades` | 학기별 과목 성적, 신청/취득/재수강 학점 합계 | 수강/성적 조회 | `AtnlcScreSungjukInfo.do`, `AtnlcScreSungjukTot.do` | 검증 | ✅ |
| `ranking` | 학기별 석차, 평점 | 석차 조회 | `/std/cps/inqire/StandStdList.do` | 검증 | ✅ |
| `scholarships` | 장학 이력 | 장학 조회 | `JanghakHistoryStdList.do` | 추정 | ✅ |

### E. 졸업요건

| 명령 | 내용 | 출처 | 엔드포인트 | 검증 | 위험 |
|---|---|---|---|---|---|
| `graduation` | 전공/교양/기타별 신청·삭제·**취득학점**(재수강 포함), 평량평균 + 교양 이수현황(필수 광운인되기, 균형교양 8개 영역) | KLAS 수강/성적, 교양 이수현황 | `AtnlcScreSungjukTot.do`(`*ChidukHakjum`=취득), `GyoyangIsuInfo.do`, `AtnlcScreProgramGubun.do`(학위과정·공학인증 여부) | 검증 | ✅ |
| `graduation --rules` | **졸업기준표 PDF** (로그인 필요, 220KB). 경로에 연도가 들어 있으므로 `GyoyangIsuStdPage.do`의 링크를 읽어서 받음 | 교양 이수현황 "졸업기준표" | 현재 `GET /assets/custom/doc/sungjuk_info_2025.pdf` | 관찰 (PDF 내용 미확인) | ✅ |
| `graduation --check` | 졸업가부·불가사유 (졸업예정자 명단에 있을 때만 데이터가 나옴) | 졸업가부 확인 | `/std/ext/grdtn/SelectGraduateCheck.do` | 검증(현재 빈 응답) | ✅ |
| (공학인증 학과) | 공학프로그램 이수현황·선수과목 | 공학교육 | `LrnRsltPersonCheck.do` 등 | 관찰 | ✅ |

※ KLAS에는 "학과별 졸업요건 자동 판정" 화면이 없음. 수강/성적 화면에 "6) 연도/학과별 졸업이수학점" 열 제목은 있지만 바인딩된 데이터가 없음. → 기준표(PDF)와 취득학점을 에이전트가 비교해 남은 요건을 계산함.

`GyoyangIsuInfo.do` 코드 → 영역 (화면 템플릿에서 확인):

| 코드 | 영역 |
|---|---|
| `aa8128` | 광운인되기 (필수교양) |
| `aa62` | 대학실용영어 |
| `aa64` | 언어와표현 |
| `aa63 + aa76` | 과학과기술 (구 정보영역 포함) |
| `aa65` | 인간과철학 |
| `aa66` | 사회와경제 |
| `aa67` | 글로벌문화와제2외국어 |
| `aa68` | 예술과체육 |
| `aa7881` | 수리와자연 |
| `aa83`, `aa84` | 미확인 (화면에 표시 안 됨) |

규칙(화면 안내문, 2025학번 기준): 균형교양 8개 영역 중 **최소 4개 영역 포함 30학점**. 2016~2024 입학생은 광운인되기 + 균형교양으로 입학년도별 총 교양학점 충족. 3·4학점 과목만 균형교양 인정(실기 제외). 공학인증 학과는 별도 체계. → 2026학번부터 체계가 또 바뀜(AI리터러시, 9개 영역). 연도별 규칙은 스킬에 박지 않고 원문에서 읽는다: §10, [graduation.md](../skills/klas/references/graduation.md).

### F. 공지·자료

| 명령 | 내용 | KLAS 메뉴 | 엔드포인트 | 검증 | 위험 |
|---|---|---|---|---|---|
| `notices [과목]` | 강의 공지 목록 | 강의 공지사항 | `/std/lis/sport/d052b8f845784c639f036b102fdc3023/BoardStdList.do` | 검증 | ✅ |
| `materials [과목]` | 강의 자료실 목록 + 첨부파일 목록 | 강의 자료실 | `/std/lis/sport/6972896bfe72408eb72926780e85d041/BoardStdList.do`, `/common/file/UploadFileList.do` | 검증 | ✅ |
| `qna`, `student-materials` | 강의 Q&A, 수강생 자료실 | 각 게시판 | `573f918c.../BoardStdList.do`, `70778131.../BoardStdList.do` | 추정 | ✅ |
| `post <과목> <글번호>` | 게시글 본문(시험범위 공지 등) | 게시판 상세 | `.../BoardStdView.do` | 추정 | ⚠️ 조회수 +1 |
| `download <첨부>` | 강의자료 파일을 로컬로 저장 → 에이전트가 읽음 | 첨부 다운로드 | `UploadFileList.do`의 `download` URL (GET) | 관찰 | ⚠️ 열람 기록 가능 (허용됨) |
| `alerts` | KLAS 알림 이력 | 알림 | `/mst/sys/optrn/SelectPushMsgHisList.do` | 검증 | ✅ |

### G. 일정·시험 스케줄

| 명령 | 내용 | 출처 | 엔드포인트 | 검증 | 위험 |
|---|---|---|---|---|---|
| `calendar [YYYY-MM]` | 학사일정 + 과제 마감 + 개인 일정 통합 | KLAS 홈 캘린더 | `/std/cmn/frame/SchdulStdList.do {schdulYear, schdulMonth}`, `/std/ads/admst/MySchdulMonthTableList.do` | 검증 | ✅ |
| `academic-calendar` | 학교 전체 학사일정(중간·기말고사 기간, 수강신청 등) | kw.ac.kr 공개 | `GET https://www.kw.ac.kr/KWBoard/list5_detail.jsp` | 검증 | ✅ |
| `kw-notices [검색어]` | 학교 대표 공지 | kw.ac.kr 공개 | `GET https://www.kw.ac.kr/ko/life/notice.jsp` | 추정 | ✅ |

과목별 시험 일정 = 학사일정의 시험 기간 + 강의계획서 8·16주차 계획 + 강의 공지 + 온라인시험 목록을 합쳐서 판단.

### H. 에이전트 합성 기능 (KLAS 기능이 아니라 SKILL.md 지침으로 제공)

- **오늘/이번 주 브리핑**: `courses` + `todo` + `calendar`
- **시험공부 가이드**: `syllabus`(주차 계획·평가 비율) + `materials`/`download`(강의자료) + `notices`(시험범위) + `academic-calendar`(시험 기간) → 범위 정리, 학습 순서, 예상 문제
- **출석 위험 경고**: 결석·지각 수 vs 강의계획서 출석 반영 비율
- **졸업까지 남은 것**: `graduation` + 기준표 비교

### I. 기억(메모리) + 자료 보관함

두 가지를 분리함:
- **기억 = KLAS에 없는 사실**. 사용자가 말로 알려준 것(시험 시간·범위, 교수님 말씀, 휴강 등)을 저장했다가 이후 답변에 반영. 자료 요약은 저장하지 않음 (시험공부는 항상 원본 자료로).
- **자료 보관함 = 다시 받지 않기 위한 원본 캐시**. 강의자료 파일과 사용자가 넣은 녹음·필기.

```
~/.klas-agent/                    ← KLAS_HOME (.env에서 경로 변경 가능, 예: OneDrive 폴더)
├─ session.json                   세션 쿠키 (자동)
├─ MEMORY.md                      과목과 무관한 기억
└─ 2026-2/
   └─ 자료구조/
      ├─ MEMORY.md                과목 기억
      ├─ materials/               KLAS 강의자료 원본 (sync가 새 파일만 받음)
      │  └─ .manifest.json        받은 파일 기록 (attachId, fileSn, 크기, 받은 시각)
      └─ my/                      사용자가 직접 넣는 곳: 강의 녹음·녹취록, 필기, 판서 사진
```

과목 `MEMORY.md` 형식 (사람도 직접 열어 고칠 수 있게 마크다운):

```markdown
# 자료구조 (2026-2)

## 시험
- [기말] 범위: 스택, 큐까지 — 2026-10-28 사용자 전달 ("시험범위 스택이랑 큐까지래")
- [기말] 시간: 17:00 — 미확정 ("5시에 시험볼거같다고 하시네"), 2026-10-28 사용자 전달

## 기타
- (예) 3주차 과제 마감 1주 연장 — 2026-10-21 사용자 전달
```

| 명령 | 내용 | 위험 |
|---|---|---|
| `memory [과목]` | 과목 `MEMORY.md` 경로와 내용 출력 (없으면 빈 파일 생성). 에이전트는 이 파일을 직접 수정 | ✅ 로컬만 |
| `sync [과목]` | 자료실 목록(JSON 1회)으로 새 첨부만 확인 → **새 파일만** `materials/`에 저장 | ⚠️ 새 파일 다운로드 시 열람 기록 가능 (허용됨). 게시글 본문은 열지 않음 |

과목을 받는 조회 명령(`course`, `syllabus`, `exams`, `assignments` 등)은 결과에 그 과목의 `memory`를 함께 붙여서, 에이전트가 따로 찾지 않아도 기억을 보게 함.

에이전트 규칙 (SKILL.md에 명시):
1. 사용자가 KLAS·강의계획서·공지에 없는 과목 정보를 말하면 그 과목 `MEMORY.md`에 날짜와 원문 표현을 붙여 저장하고, 무엇을 저장했는지 한 줄로 알려준다.
2. "이번 시험" 같은 상대 표현은 오늘 날짜와 학사일정으로 **어떤 시험인지 구체화**해서 저장한다(예: 2026-2 기말). 구체화가 애매하면 저장 전에 한 번만 묻는다.
3. "~같다", "~래" 같은 불확실한 말은 `미확정`으로 표시한다.
4. 같은 항목이 바뀌면 덮어쓰고 이전 값은 괄호로 남긴다. 예: `범위: 트리까지 (이전: 큐까지, 10-28)`
5. 과목 관련 답변 전에 기억을 확인한다. KLAS 데이터와 다르면 둘 다 보여주고, 더 최근의 사용자 전달을 우선한다고 밝힌다.
6. 시험공부·문제 생성은 기억에 있는 범위로 자료를 좁히되, 내용은 항상 `materials/`의 **원본**에서 가져온다.
7. 강의자료가 필요하면 `sync` 후 로컬 원본을 읽는다. `sync`는 새 파일만 받으므로 반복 요청에도 다시 다운로드하지 않는다.
8. 사용자가 가진 녹음·영상 파일(`my/`의 녹음, `sync`로 받은 자료실 첨부 mp4 등)은 오디오·영상을 다룰 수 있는 에이전트면 직접 쓰고, 아니면 녹취록(txt/md)을 읽거나 변환을 안내한다(클로바노트·Whisper 등). KLAS 온라인 강의 영상: 목록 API(`SelectOnlineCntntsStdList.do`)의 `starting`에 kwcommons 영상 페이지 링크(`https://kwcommons.kw.ac.kr/em/<id>`)가 있어 `videos`의 `link`로 낸다(사용자 결정, 2026-10-29). 1건 확인(2026-10-29): 로그인 없이 200으로 열리고(그래서 요청이 사용자 KLAS 계정과 연결되지 않음), 페이지는 YouTube embed iframe, 메타 `commons.progress_support=false`. 같은 날 과목별 1건씩 더 확인: 온라인 강의가 있는 6과목 중 YouTube는 1과목뿐, 나머지 5과목은 학교 서버 영상(uniplayer, `commons.content_type` 2·18, `progress_support=true`, 로그인 없이 200). 이 플레이어는 `content.php?content_id=<id>`로 콘텐츠 정보를 받고 자막 스크립트 패널(`caption-script.js`)이 있다. 자막 파일이 실제로 있는지는 미확인. 스킬은 링크를 돌려주는 데까지만 한다(사용자 결정, 2026-10-29). 링크로 영상을 어떻게 쓸지는 스킬 범위 밖이고, 영상 파일은 받지 않는다. KLAS 뷰어·학습 인증은 계속 금지.

### ⛔ 절대 구현하지 않는 것 (화이트리스트에서 제외, 호출 시 즉시 거부)

| 동작 | 엔드포인트 예 |
|---|---|
| 영상 재생·진도 기록·인증 우회·영상 다운로드 | 뷰어 `/spv/lis/lctre/viewer/LctreCntntsViewSpvPage.do`, `CertiStdCheck.do`, 진도 저장 API |
| QR/전자 출석 체크 | `/mst/ads/admst/KwAttendQRCodeInsert.do`, `CertiPushSucStd.do` |
| 과제 제출, 퀴즈·시험 응시 | 제출/응시 화면 일체 |
| 개인 일정 추가·수정·삭제 | `MySchdulSave.do`, `MySchdulDelete.do` |
| 수강신청·포기, 전공 신청, 휴복학, 학점포기 | `...신청` 화면 일체 |
| 수업평가·설문 제출 | `LctreEvlStdPage.do`, `QustnrStdPage.do` |
| 비밀번호·개인정보 변경, 로그아웃 | `UserFrstPwdPage.do`, `fnCmdLogout` |

## 5. 구현 방식 (제안)

- **런타임: Node.js 18+ 단일 스크립트, 의존성 0개** (fetch·RSA 암호화가 내장). Codex·opencode가 npm으로 배포되므로 Node는 대상 환경에 항상 있음. Node `fetch`는 쿠키를 자동 보관하지 않으므로 `headers.getSetCookie()`로 `SESSION`을 직접 읽어 다음 요청에 붙임.
- **읽기 전용 보장**: 명령별로 고정된 엔드포인트만 호출. "임의 URL 호출" 기능 없음. 로그인 3개 POST 외엔 화이트리스트 밖 요청 불가.
- **자격증명**: `.env`(`id`, `pw`)를 스크립트만 읽음. 비밀번호는 에이전트 대화·출력·로그에 절대 노출 안 함.
- **로컬 저장 범위**: `SESSION` 쿠키, 강의자료 원본, 사용자 자료(`my/`), 기억(`MEMORY.md`)만 `KLAS_HOME`에 저장. 성적·출석·학적 같은 조회 결과는 저장하지 않고 매번 새로 받음. 세션이 만료되면 1회 재로그인.
- **스킬 설치 위치** (각 공식 문서로 확인):

| 에이전트 | 프로젝트 | 전역 |
|---|---|---|
| Claude Code | `.claude/skills/klas/` | `~/.claude/skills/klas/` |
| Codex | `.agents/skills/klas/` | `~/.agents/skills/klas/` |
| opencode | `.agents/skills/` 또는 `.claude/skills/` (둘 다 읽음) | `~/.config/opencode/skills/`, `~/.agents/skills/` |
| Antigravity | `.agents/skills/klas/` | `~/.gemini/config/skills/` (앱/IDE), `~/.gemini/antigravity-cli/skills/` (CLI) |

→ 원본은 `skills/klas/` 하나(배포 구조, §9). `SKILL.md`(frontmatter `name`, `description`) + `scripts/klas.mjs`.

## 6. 구현 결과 (2026-10-28, 실제 계정으로 검증)

구현: `skills/klas/` (`SKILL.md`, `scripts/klas.mjs`), 테스트는 `tests/klas.test.mjs`. 위 표의 검증 표기보다 이 절이 최신이다.

- **로그인**: 스크립트 HTTP 로그인 성공(1회). 정직한 User-Agent(`klas-agent/0.1`)로 동작. 세션 없음/만료 응답은 `200 {"redirect":true,"redirectUrl":"/usr/cmn/login/LoginForm.do..."}` (실측).
- **잠금 방지**: 병렬 3개 실행 시 `LoginConfirm` 1회만 호출됨(측정). 같은 자격증명으로 실패한 기록이 있으면 재시도하지 않음.
- **추정 → 검증으로 바뀐 것**
  - `assignment`: `TaskStdView.do {selectYearhakgi, selectSubj, ordseq, taskNo}` → `{rpt:{title, contents(HTML), atchFileId, ...}}`. 직전 `TaskStdList` 호출 후 제목 일치를 확인함.
  - `post`: `BoardStdView.do {cmd:"select", ...ctx, boardNo, masterNo, storageId:"CLS_BOARD"}` → `{board:{title, content, ...}}`. 작성자 IP 필드는 출력에서 제거.
  - 다운로드: `GET /common/file/DownloadFile/{attachId}/{fileSn}` → 실제 PDF. 과제 첨부도 `UploadFileList.do`(storageId `CLS_BOARD`)로 목록 조회됨.
  - `scholarships`(`JanghakHistoryStdList.do {}`): 동작.
  - `projects`, `discussions`, `quizzes`, `exams`, `qna`, `student-materials`: 호출은 정상이나 이번 학기 데이터가 없어 필드는 미확인.
  - 졸업기준표 PDF: "졸업이수학점 안내" — 입학년도별 × 단과대별 교양·주전공·복수/부전공·졸업이수학점 표.
- **sync**: 자료구조 9개 파일 저장, 두 번째 실행은 9개 모두 건너뜀.
- **뺀 것**
  - `kw-notices`: www.kw.ac.kr 공지 페이지가 브라우저가 아닌 요청을 400으로 거부. 우회하지 않음.
  - `attendance --kw`: KW출첵 상세 API(`/mst/ads/admst/KwAttendStdAttendList.do`)의 요청 형식을 확인하지 못함. 출결은 `LrnSttusStdAtendList.do`로 제공.

## 7. 미확인 항목 해결 (2026-10-28, KLAS+ 코드 근거 + 실측)

- **출결 코드**: O 출석, L 지각, R 조퇴, X 결석, A 공결 (KLAS+ `lib/lecture/lectureUtils.js`). `LrnSttusStdAtendList`의 라벨과 `LctrumHomeStdInfo.atendSubList`(pgr1~4)가 자료구조 과목에서 일치함(출석 9).
- **결석 기준**: 강의계획서 화면 안내문 — "실제 수업시간 수의 4분의 1 이상 결석한 과목에 대하여는 해당 학기의 학업성적을 인정하지 않는다"(「수업 운영에 관한 규정」), 출석 반영은 최소 10/100.
- **강의계획서 필드**: `learnBiyul`=수업태도, `*Expect`=항목별 기대평균치(100점 만점), `evaluationOpt`=수업평가 문항 유형(experiment 실험/실습, english 외국어, rec 원격수업, tbl, pbl, discussion 토론식, practice 실기, etc 기타). 상대/절대평가 정보는 강의계획서에 없음 → 학교 `bachelor_info05.jsp`(성적평가 안내)에 기준과 비상대 평가과목이 있음(§8).
- **퀴즈·시험 필드**: KLAS+는 `LctrumHomeStdInfo`의 `examTop`/`anQuizTop`에서 `papernm`, `sdates`, `edates`, `submityn`을, KLAS Helper는 `AnytmQuizStdList`에서 `issubmit`, `edt`를 읽음. `todo`는 두 이름을 모두 받도록 처리(이번 학기 데이터가 없어 실측은 못 함).
- **학교 대표 공지 복구**: 이전의 400 응답은 User-Agent가 아니라 쿼리 파라미터(`srCategoryId`, `tpage`) 누락 때문이었음. 정직한 UA로 동작 확인. 분류 ID: 1 학사, 2 학생, 3 봉사, 4 등록/장학, 5 입학, 6 시설, 7 병무, 8 외부. 본문: `?BoardMode=view&DUID=<id>`. 페이지 하단 '담당부서'는 홈페이지 관리부서(홍보기획실)라 쓰지 않음.
- **KW출첵 상세**: KLAS+도 직접 호출하지 않음(URL 상수만 있음). 출결은 `LrnSttusStdAtendList`로 충분.

## 8. KLAS 밖 공개 출처 (2026-10-28)

학교 사이트맵(`/ko/info/sitemap.jsp`)을 훑고 주요 페이지 접속을 확인함. 질문별 지도는 [sources.md](../skills/klas/references/sources.md). 이전 판단을 바꾸는 발견:

- **전공필수 목록은 있다.** `/ko/life/bachelor_info02.jsp`에 학과별 필수과목표(엑셀), `bachelor_info01.jsp`에 학과별 교과과정표(엑셀). 재학 연도·학기별로 보는 방식. 엑셀 내부 구조와 과거 연도 포함 여부는 미확인.
- **전체 강의시간표 파일이 공개.** `bachelor_info13.jsp`에 학기별 강의시간표 첨부. ② 수강신청 조합은 과목마다 `LectreTimeInfo`를 부르지 않고 이 파일로 할 수 있음(파일 형식 미확인, 파서 필요).
- **상대/절대평가 기준**: `bachelor_info05.jsp` (비상대 평가과목 목록 포함).
- **교시→시각**: `bachelor_info03.jsp` (주간 75분제).
- **다전공**: `bachelor_info11.jsp` (심화·복수·부전공, 연계·마이크로·학생설계전공).
- 대학요람 최근 연도는 학교 밖 전자책 사이트에 있음. `rule.kw.ac.kr`은 스크립트 이동이라 단순 조회로 본문이 안 보일 수 있음. `teacher.kw.ac.kr`은 확인일에 접속 실패.

## 9. 배포 구조 (2026-10-29)

주요 스킬 저장소를 따름: [anthropics/skills](https://github.com/anthropics/skills)(`skills/<이름>/` + `.claude-plugin/marketplace.json`, `strict: false`), [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills)(`skills/<이름>/`, `npx skills add`), [Agent Skills 명세](https://agentskills.io/specification)(`name`은 폴더 이름과 같게, `description` 1024자 이하, `scripts/`·`references/`).

- 스킬 원본 `skills/klas/`, 테스트는 사용자에게 복사되지 않도록 `tests/`로 뺌. `.agents/`, `.claude/skills/`는 이 저장소에서 쓰는 로컬 복사본(`install`로 생성, git 제외).
- `npx skills`(v1.7.4, 소스 `src/agents.ts`·`src/installer.ts` 확인): `skillsDir`가 `.agents/skills`인 에이전트(Codex·opencode·Antigravity·Antigravity CLI)는 프로젝트 `.agents/skills/`, 전역 `~/.agents/skills/`에 설치. Claude Code는 그 위치에 복사한 뒤 `~/.claude/skills/klas`를 링크(Windows는 junction)로 연결. `--copy`면 각 에이전트 폴더에 바로 복사.
- Antigravity CLI는 `~/.agents/skills`를 읽지 않음(Google codelab) → 전역은 `~/.gemini/antigravity-cli/skills`에 따로 복사.
- 자격증명: 스크립트가 남의 프로젝트(`<project>/.agents/skills/klas`)에 설치되면 그 프로젝트 `.env`의 `id`/`pw`를 읽던 문제를 고침. 일반 키는 `~/.klas-agent/.env`와 이 원본 저장소 루트(`skills/klas/SKILL.md` + `.claude-plugin/marketplace.json`이 있는 곳)에서만 읽음.
- 확인 못 한 것: `npx skills add` 실제 실행(외부 코드 실행이라 이번 작업에서 돌리지 않음), 네 에이전트가 설치된 스킬을 실제로 인식하는지.

## 10. 졸업요건 출처와 연도 대응, 수강신청 검색 (2026-10-29)

- **졸업기준표 PDF**(`sungjuk_info_2025.pdf`, 13쪽): 2025학번부터 2003학번 이전까지 입학연도별 졸업이수학점·교양 이수체계. 표 제목에 "OO학년도 2학년 편입생, OO학년도 3학년 편입생 포함"이 있어 편입생은 신입학 연도 행을 따름. 공학인증 요건은 "p.43"(대학요람)을 가리키기만 함.
- **학교 홈페이지 `bachelor_info12.jsp`가 더 최신**: 2026학번 탭이 있음(필수교양 AI리터러시 3, 균형교양 9개 영역(기초학문융합 추가) 중 계열별 필수 영역 포함 4개 이상 30학점, 교양 33). 2025학번 '광운인되기'는 홈페이지에서 폐지로 안내(PDF는 1학점).
- **KLAS 교양 이수현황 화면**(`GyoyangIsuStdPage.do`): 9칸 고정 템플릿(`aa8128` 광운인되기, `aa62`·`aa64`·`aa63+aa76`·`aa65`·`aa66`·`aa67`·`aa68`·`aa7881`). 연도별 분기 없음. 기준표 링크도 HTML에 고정으로 박혀 있음 → 학교가 손으로 바꿈.
- **코드 대응**: `graduation`이 기준표 링크를 모두 읽고(`rulesPdfs`), 매핑 밖 `aa*` 코드를 모두 `unknownCodes`로 내보내고, 입학연도가 기준표 연도보다 늦으면 `rulesWarning`. 연도가 박힌 곳은 `GYOYANG_AREAS` 하나.
- **수강신청 = 강의계획서 검색**: `LectrePlanStdList.do`는 지난 학기(2026,1)도 결과를 주고, 다음 학기(2027,1)는 지금 `[]` → 공개 전. 학과 필터(`selecthakgwa`)는 `CmmnHakgwaList.do`의 `classCode`(= 강의계획서의 `openMajorCode`). 시간은 `LectreTimeInfo.do`(`dayname1`/`timeNo1`…, 과목당 여러 행·여러 쌍 가능). KLAS 화면은 '전체' 검색에 과목명·교수명을 요구하므로 스크립트도 키워드를 필수로 둠. 키워드 없이 학과만 넣어도 서버는 목록을 줌(실측 26건).
- **(같은 날 추가) 사용자 결정**: 강의계획서 검색에서 키워드 없이 학과 단위 목록 허용(`--dept`만, 학교 전체 목록은 막음). 실측 한 학과 2026-1 30건.
- **공학교육 메뉴** (`/std/egn/`): `LrnRsltPersonCheck.do`(대상·프로그램), `LrnRsltPgmCheck.do`(`certOpt`), `IsuCheck.do`(`thisYear`·`hakgi`·`pgmNo` → 그 학기 수강과목의 선수 지정과목·이수·승인. 응답의 학번·교번·휴대전화는 버림), `LrnRsltgetExistYn.do` + `LrnRsltGraduInfo.do`(학습성과 평가, 학과가 입력 전이면 0/빈 응답). `LrnRsltGraduNew.do`는 화면이 데이터 없을 때 부르지만 쓰기 여부가 불분명해 허용 목록에서 뺌. 개인별 공학인증 졸업 심사서는 `/spv/cmn/reprt/GraduateKecStd.do` → `report.kw.ac.kr:8585` Crownix 뷰어(암호화 파라미터)라 읽지 않음. 선·후수 준수제도 안내 PDF(`/html/cert_change/cert_change_info2023.pdf`)는 로그인 없이 공개.
- **졸업요건 문서 방식 변경**: 학번별 기준은 한번 정해지면 그 학번에게 바뀌지 않으므로(소급 완화는 홈페이지에 반영), 숫자 스냅샷 대신 "학번 → 홈페이지 탭 / PDF 절" 참고 위치 표로 바꿈. 처음 찾은 위치는 사용자 전역 기억에 한 줄로 남김.

## 11. 졸업요건 원본 전수 조사 (2026-11-02)

**설계: 참조 파일에는 위치만 적고 값은 넣지 않는다**(§10과 같음). "졸업요건은 빠지는 것 없이 모두"라는 요청을 값을 복사해 넣으라는 뜻으로 잘못 읽고 표와 규칙을 99개 파일로 넣었다가, 사용자 확인 뒤 위치 안내로 되돌림. 그래서 값을 쓸 때 파일 형식 때문에 겪는 어려움이 그대로 남고, 파일을 못 읽는 에이전트는 위치만 안내한다. 아래는 그 조사에서 얻은 원본 구조다.

- **필수과목표**(`must_2026_NN.xls`, 33개 파일)는 1991~2026년을 한 파일에 담음. 학과마다 시작 연도가 다름. 학기는 1학기·2학기 학점 칸 중 어디에 값이 있는지로 구분. 지난 조사의 '과거 연도 미확인'은 해결. 건축학과는 5학년 칸이 있음.
- **교과과정표**(`life00_2026_NN.xlsx`, 36개)는 학년도별. 표 위 연도 행이 `[2026학년도]`, `【 2020학년도 】`, `2001햑년도`처럼 제각각.
- **수강신청 자료집** `2026-2`(120쪽, `Download.jsp?fuid=34965&ano=52978`)이 졸업 정보의 핵심 원본. 기준표 PDF의 '자세한 내용은 p.43'은 이 자료집의 공학교육인증 절을 가리킴(학기마다 쪽이 다름, 이번엔 45~81쪽). `pdftotext -layout`은 표를 뒤섞어 못 씀(개강일이 4월 28일로 보임) → PyMuPDF `find_tables()`, 병합 칸은 왼쪽 값으로 채우지 않음. 표시 쪽과 PDF 쪽의 차이가 앞뒤로 달라서(4, 2) 쪽 아래 번호로 맞춤.
- **학교 페이지 오류**: `bachelor_info02.jsp`의 금융부동산법무학과 링크가 국제학부 파일(`must_2026_34.xls`)을 가리킴. `must_2026_27.xls`는 400. `bachelor_info09.jsp`는 이제 빈 페이지(462바이트). `bachelor_info11.jsp`의 마이크로전공 표는 HTML이 중간에 닫혀 일부 행이 표 밖에 있음.
- **원본 간 차이**는 `graduation.md` §4에 모음. 2024학번 필수/균형 13/18(홈페이지 표) vs 1/30(같은 페이지 이수체계, 자료집), 동북아문화산업학부 2024 단일전공 66 vs 60이 대표적.
- **홈페이지와 자료집 대조**: 졸업학점 표의 숫자 행이 연도별로 일치함을 확인(2024는 다르고, 2020~2023은 자료집에 기초교양 칸이 더 있음).
- **`rule.kw.ac.kr`**은 `lawFullView.do`가 스크립트로 본문을 그리고 `lawDetail_areaC.do`는 302 → 단순 조회 불가. 규정 원문은 넣지 않고 URL만 둠. 학칙 조항 번호 기준의 대조는 하지 않음.
- **대학요람**: 2019~2020부터는 외부 전자책 사이트에 있어 받지 않음. 자료집이 같은 내용을 더 최신으로 담음.
- `cert_change_info2023.pdf`는 HEAD가 403이지만 GET은 열림(공개). 최신 선·후수 목록은 자료집에 있어 이 PDF는 제도 설명용으로만 씀.
- `fs.rmSync`는 Node 24 Windows에서 한글이 든 경로면 파일 하나여도(없는 파일이어도) 프로세스가 죽음(0xC0000409, 실측). `fs.unlinkSync`는 정상.
- **학과 내규 위치**(`departments.md`, 37개 학과): 확인됨 21, 일부만 확인 5, 못 찾음 11. 수학과·전자바이오물리학과·정보콘텐츠학과·자산관리학과는 학교 소개에 홈페이지 링크가 없음. Wix·Canva 사이트(`kwmedia.info`, `envkw.com`, `kwuarchitecture.com`, `kwdois.my.canva.site`)는 브라우저로만 읽힘. `kwmedia.info` 글 주소는 사이트맵의 `dynamic-notices-2026_*`에 있음. 내규 hwp 첨부(전자통신, 전자재료, 전자융합, 참빛인재대학)는 받지 않아 내용 미확인.
- 학과 공지에 졸업예정자 학번 명단이 그대로 있는 경우가 있음(미디어커뮤니케이션학부). 규칙만 옮기고 명단과 제출 메일 주소는 옮기지 않음.
