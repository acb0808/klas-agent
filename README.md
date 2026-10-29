# 바로 시작

```bash
npx skills add acb0808/klas-agent -g
```

설치한 뒤 에이전트에게 **"KLAS에서 이번 주 할 일 알려줘"** 라고 말하세요. 처음이면 에이전트가 "로그인 해주세요!"와 함께 로그인 명령을 알려 줍니다. 그 명령을 터미널에서 실행하고 학번·비밀번호를 입력하면 끝입니다. Node.js 22.20 이상이 필요합니다.

# KLAS 에이전트 스킬 (광운대학교, 읽기 전용)

Claude Code · Codex · opencode · Antigravity가 KLAS에서 과제·영상·시험 일정을 직접 읽어 와서 답하게 해 주는 [Agent Skill](https://agentskills.io)입니다. 과목·과제·영상 강의·출석·성적·졸업요건·강의자료·학사일정을 조회하고, 사용자가 말해 준 시험 범위 같은 정보를 기억합니다. KLAS에 없는 정보(필수과목표, 장학 기준, 학칙 등)는 학교 홈페이지 어디를 보면 되는지 찾아 줍니다.

> 광운대학교의 공식 서비스가 아닙니다. 학생 개인이 만든 도구이며, 본인 계정으로 본인 정보만 조회합니다.

## 이렇게 말해 보세요

**📅 할 일**
- "이번 주 뭐부터 해야 해? 하루 두 시간 있어"
- "마감 안 지난 과제 마감순으로 보여줘"
- "이번 학기 과제랑 시험이 언제 몰려?"
- "오늘 알바 생겨서 아무것도 못 했어"

**🎬 강의**
- "자료구조 아직 안 들은 영상 있어? 링크도 줘"
- "자료구조 3주차 강의 요약해줘"
- "지난주 수업 못 갔어. 뭐 놓쳤어?"
- "자료실에 새 파일 올라왔어? 받아 줘"
- "이 과제 뭘 하라는 건지 모르겠어"

**📝 시험**
- "교수님이 기말 범위 스택이랑 큐까지래"
- "시험까지 5일 남았어. 범위 공부 계획 짜줘"
- "범위에서 예상 문제 10개 만들어줘"
- "기말에서 몇 점 받아야 해?"

**🎓 졸업 · 수강신청**
- "졸업하려면 뭐가 남았어?"
- "다음 학기 18학점, 금요일 비우고 전공필수 챙겨서 시간표 짜줘"
- "출석 괜찮아? 결석 몇 번까지 돼?"
- "지난 학기 성적이랑 석차 보여줘"

**📢 공지 · 학교생활**
- "내가 봐야 할 학교 공지만 골라줘"
- "신청할 수 있는 장학금 있어?"
- "휴학하려면 언제까지 뭘 해야 해?"
- "팀원 다섯 명 언제 모일 수 있어?"

### 🚫 하지 않는 것

과제 제출, 퀴즈·시험 응시, 출석 체크, 영상 재생, 일정 등록, 수강신청은 **하지 않습니다.** 스크립트가 조회용 주소만 허용하도록 막혀 있습니다. 영상은 링크만 알려 주고, 출석으로 인정받으려면 KLAS에서 직접 봐야 합니다.

로그인 정보는 내 컴퓨터에만 있고, 스크립트는 `klas.kw.ac.kr`·`www.kw.ac.kr`에만 요청합니다. 에이전트는 비밀번호를 묻거나 `.env`를 열지 않도록 지시받습니다.

## 1. 설치

스킬 실행에는 Node.js 20 이상, 아래 `npx skills` 설치 도구에는 Node.js 22.20 이상이 필요합니다.

### 한 번에 (권장)

```bash
npx skills add acb0808/klas-agent -g
```

[skills CLI](https://github.com/vercel-labs/skills)가 설치할 에이전트를 물어봅니다. `-g`를 빼면 지금 폴더(프로젝트)에만 설치됩니다.

### 에이전트별

| 에이전트 | 명령 (전역) | 설치되는 곳 |
|---|---|---|
| Claude Code | `npx skills add acb0808/klas-agent -g -a claude-code` | `~/.claude/skills/klas` (`~/.agents/skills/klas`로 연결) |
| Codex | `npx skills add acb0808/klas-agent -g -a codex` | `~/.agents/skills/klas` |
| opencode | `npx skills add acb0808/klas-agent -g -a opencode` | `~/.agents/skills/klas` |
| Antigravity (앱·IDE) | `npx skills add acb0808/klas-agent -g -a antigravity` | `~/.agents/skills/klas` |
| Antigravity CLI | 아래 '직접 설치' 참고 | `~/.gemini/antigravity-cli/skills/klas` |
| 여러 개 한 번에 | `npx skills add acb0808/klas-agent -g -a claude-code -a codex -a opencode -a antigravity -y` | |

Antigravity CLI는 `~/.agents/skills`를 읽지 않습니다([Google codelab](https://codelabs.developers.google.com/getting-started-with-antigravity-skills)). npx로 설치한 뒤 `~/.agents/skills/klas` 폴더를 `~/.gemini/antigravity-cli/skills/`에 복사하거나 '직접 설치'를 쓰세요.

### Claude Code 플러그인으로

Claude Code 안에서:

```
/plugin marketplace add acb0808/klas-agent
/plugin install klas@klas-agent
```

터미널에서는 `claude plugin marketplace add acb0808/klas-agent` 다음에 `claude plugin install klas@klas-agent`. 플러그인으로 설치하면 스킬 이름이 `klas:klas`가 됩니다. **npx와 플러그인 중 하나만 쓰세요.** 둘 다 설치하면 Claude에 같은 스킬이 두 개 보입니다.

### 직접 설치 (npx 없이)

```bash
git clone https://github.com/acb0808/klas-agent
```

```bash
node klas-agent/skills/klas/scripts/klas.mjs install --global
```

있는 에이전트 폴더에만 복사합니다: `~/.agents/skills`(Codex·opencode·Antigravity), `~/.claude/skills`, `~/.gemini/config/skills`(Antigravity 전역), `~/.gemini/antigravity-cli/skills`. `--global` 없이 실행하면 지금 폴더의 `.agents/skills`, `.claude/skills`에 복사합니다.

### 업데이트·삭제

```bash
npx skills update
```

```bash
npx skills remove klas
```

플러그인은 `/plugin`에서 업데이트·삭제합니다.

## 2. 로그인 정보

로그인 정보가 없으면 에이전트가 "로그인 해주세요!"와 함께 아래 같은 명령을 알려 줍니다. 터미널(PowerShell, macOS 터미널)에서 실행하고 학번과 비밀번호를 입력하세요. 비밀번호는 화면에 보이지 않고, 로그인이 되는지 확인한 뒤에만 `~/.klas-agent/.env`에 저장됩니다.

```bash
node "$HOME/.agents/skills/klas/scripts/klas.mjs" setup
```

경로는 설치 방법마다 다르니 에이전트가 알려 준 명령을 쓰세요. 에이전트는 이 명령을 대신 실행하지 않습니다(에이전트 셸에서는 거부됨).

직접 만들어도 됩니다. `~/.klas-agent/.env`(Windows: `C:\Users\<사용자>\.klas-agent\.env`)에 적습니다.

```
id=학번
pw=비밀번호
```

- 다른 프로젝트 폴더의 `.env`에서는 `KLAS_ID`, `KLAS_PW`, `KLAS_HOME`처럼 `KLAS_`로 시작하는 키만 읽습니다. 스킬이 남의 프로젝트에 설치돼도 그 프로젝트의 `id`/`pw`가 KLAS로 전송되지 않게 하기 위해서입니다.
- clone한 저장소 폴더 **안에서** 쓸 때만 저장소 루트의 `.env`에서도 `id`/`pw`를 읽습니다. `install --global`로 복사한 스킬은 `~/.klas-agent/.env`만 봅니다.
- 캡차·2차 인증·로그인 실패가 나면 스크립트는 재시도하지 않습니다(5회 실패 시 계정 잠김 방지). 같은 비밀번호로 실패한 기록이 있으면 `~/.klas-agent/login-failed.json`을 지우기 전까지 다시 시도하지 않습니다.

## 3. 에이전트별 참고

- **Codex**: 샌드박스(`workspace-write`)에서 네트워크나 홈 폴더 쓰기가 막히면 `NETWORK` / `STORAGE_DENIED` 오류가 납니다. `~/.codex/config.toml`에서 허용하세요.
  ```toml
  [sandbox_workspace_write]
  network_access = true
  writable_roots = ["C:/Users/<사용자>/.klas-agent"]
  ```
  또는 `.env`에 `KLAS_HOME=./.klas-agent`처럼 작업 폴더 안을 지정합니다.
- **opencode**: 프로젝트와 전역의 `.agents/skills`, `.claude/skills`, opencode 전용 폴더를 모두 읽습니다. 같은 스킬이 여러 곳에 있으면 두 번 보일 수 있습니다.
- **Antigravity**: `~/.agents/skills`와 `~/.gemini/config/skills`를 둘 다 읽어서 '직접 설치'를 쓰면 같은 스킬이 두 번 보일 수 있습니다. 내용은 같습니다.
- **설치 후 인식**: 대부분 바로 인식합니다. 안 보이면 에이전트를 다시 시작하세요.

## 4. 저장 위치

`~/.klas-agent/` (`.env`의 `KLAS_HOME=경로`로 변경 가능, 예: OneDrive 폴더)

```
.env                         로그인 정보 (직접 만듦)
session.json                 로그인 세션 (자동)
MEMORY.md                    과목과 무관한 기억 (공부 가능 시간, 알바 일정 등)
2026-2/자료구조/MEMORY.md     과목 기억 (시험 범위·시간 등 직접 알려준 것)
2026-2/자료구조/materials/    강의자료 원본 (sync가 새 파일만 받음)
2026-2/자료구조/my/           직접 넣는 곳: 강의 녹취록, 필기, 사진
```

성적·출석 같은 조회 결과는 저장하지 않습니다.

## 5. 개발

```
skills/klas/                     에이전트에 설치되는 스킬
  SKILL.md                       에이전트 지침
  scripts/klas.mjs               조회 스크립트 (Node 20+, 의존성 없음)
  references/sources.md          KLAS 밖 정보 출처 지도
  references/graduation.md       학번별 졸업요건 참고 위치
.claude-plugin/marketplace.json  Claude Code 플러그인 마켓플레이스
tests/klas.test.mjs              안전장치·파서 테스트
docs/klas-research.md            KLAS 조사 기록 (엔드포인트, 금지 목록)
```

스킬 원본은 `skills/klas/`입니다. 이 폴더에서 에이전트로 바로 써 보려면 로컬 복사본을 만듭니다(`.gitignore`에 포함).

```bash
node skills/klas/scripts/klas.mjs install
```

테스트:

```bash
node --test tests/klas.test.mjs
```

Claude 마켓플레이스 파일 검사:

```bash
claude plugin validate .
```

## 라이선스

[MIT](LICENSE)
