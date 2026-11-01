#!/usr/bin/env node
// 광운대 KLAS 읽기 전용 CLI. 의존성 없음, Node 20+.
// 모든 요청은 http()의 화이트리스트를 통과해야 하며, 쓰기 엔드포인트는 목록에 없다.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BASE = 'https://klas.kw.ac.kr';
const UA = 'klas-agent/0.1 (read-only; node)';
const PUBLIC_CALENDAR = 'https://www.kw.ac.kr/KWBoard/list5_detail.jsp';
const KW_NOTICE = 'https://www.kw.ac.kr/ko/life/notice.jsp';
// 대표 공지는 정해진 쿼리만 허용 (다른 URL은 쿼리 자체를 금지)
const KW_NOTICE_PARAMS = {
  srCategoryId: /^\d{0,2}$/, tpage: /^\d{1,3}$/, mode: /^list$/, searchKey: /^[1-4]$/, searchVal: /^[^<>]{0,100}$/,
  BoardMode: /^view$/, DUID: /^\d{1,10}$/,
};
const KW_NOTICE_CATEGORIES = { 학사: 1, 학생: 2, 봉사: 3, 장학: 4, 등록: 4, 입학: 5, 시설: 6, 병무: 7, 외부: 8 };
const ATTENDANCE_LABELS = { O: '출석', L: '지각', R: '조퇴', X: '결석', A: '공결' }; // KLAS+ lectureUtils 근거
// 강의계획서 "수업평가 문항" 유형 (LectrePlanStdView 템플릿 근거). 상대/절대평가 구분이 아니다
const EVALUATION_TYPES = {
  evaluation_experiment: '실험/실습 실기', evaluation_english: '외국어 강의', evaluation_rec: '원격수업', evaluation_tbl: 'TBL강의',
  evaluation_pbl: 'PBL강의', evaluation_discussion: '토론식 수업(세미나 포함)프로젝트', evaluation_practice: '실기(예체능)', evaluation_etc: '기타',
};
const BOARDS = {
  notice: 'd052b8f845784c639f036b102fdc3023',
  qna: '573f918c23984ae8a88c398051bb1263',
  materials: '6972896bfe72408eb72926780e85d041',
  student: '70778131bf7a421aba99dded74b3fb6b',
};
const LOGIN_POSTS = ['/usr/cmn/login/LoginSecurity.do', '/usr/cmn/login/LoginCaptcha.do', '/usr/cmn/login/LoginConfirm.do'];
const READ_POSTS = [
  '/std/cmn/frame/YearhakgiAtnlcSbjectList.do', '/std/cmn/frame/StdHome.do', '/std/cmn/frame/SchdulStdList.do',
  '/std/cps/inqire/AtnlcScreHakjukInfo.do', '/std/cps/inqire/AtnlcScreSungjukInfo.do', '/std/cps/inqire/AtnlcScreSungjukTot.do',
  '/std/cps/inqire/AtnlcScreProgramGubun.do', '/std/cps/inqire/GyoyangIsuInfo.do', '/std/cps/inqire/StandStdList.do',
  '/std/cps/inqire/JanghakHistoryStdList.do',
  '/std/cps/atnlc/TimetableStdList.do', '/std/cps/atnlc/LectrePlanData.do', '/std/cps/atnlc/LectreTimeInfo.do',
  '/std/cps/atnlc/LectrePlanInputTabFourgrid.do', '/std/cps/atnlc/LectreBeforeGwamok.do', '/std/cps/atnlc/LectrePlanStdList.do',
  '/std/cps/atnlc/CmmnHakgwaList.do',
  // 공학교육: 대상 확인, 프로그램, 선수과목 이수현황, 학습성과 평가 결과. LrnRsltGraduNew.do는 쓰기 여부가 불분명해 넣지 않는다
  '/std/egn/chck/LrnRsltPersonCheck.do', '/std/egn/chck/LrnRsltPgmCheck.do', '/std/egn/chck/IsuCheck.do',
  '/std/egn/chck/LrnRsltgetExistYn.do', '/std/egn/chck/LrnRsltGraduInfo.do',
  '/std/lis/evltn/LctrumHomeStdInfo.do', '/std/lis/evltn/TaskStdList.do', '/std/lis/evltn/TaskStdView.do',
  '/std/lis/evltn/SelectOnlineCntntsStdList.do', '/std/lis/evltn/AnytmQuizStdList.do', '/std/lis/evltn/OnlineTestStdList.do',
  '/std/lis/evltn/PrjctStdList.do', '/std/lis/evltn/DscsnStdList.do', '/std/lis/evltn/LrnSttusStdAtendList.do',
  '/std/ext/grdtn/SelectGraduateCheck.do', '/common/file/UploadFileList.do', '/mst/sys/optrn/SelectPushMsgHisList.do',
  ...Object.values(BOARDS).flatMap((id) => [`/std/lis/sport/${id}/BoardStdList.do`, `/std/lis/sport/${id}/BoardStdView.do`]),
];
const ALLOWED_POST = new Set([...LOGIN_POSTS, ...READ_POSTS].map((p) => BASE + p));
const ALLOWED_GET = [
  /^https:\/\/klas\.kw\.ac\.kr\/usr\/cmn\/login\/LoginForm\.do$/,
  /^https:\/\/klas\.kw\.ac\.kr\/std\/cps\/inqire\/GyoyangIsuStdPage\.do$/,
  /^https:\/\/klas\.kw\.ac\.kr\/assets\/custom\/doc\/[\w.-]+\.pdf$/,
  /^https:\/\/klas\.kw\.ac\.kr\/common\/file\/DownloadFile\/[\w-]{1,100}\/\d{1,6}$/,
  /^https:\/\/www\.kw\.ac\.kr\/KWBoard\/list5_detail\.jsp$/,
];

// 교양 이수현황 코드 → 영역 (GyoyangIsuStdPage 템플릿 기준)
const GYOYANG_AREAS = {
  광운인되기: ['aa8128'], 대학실용영어: ['aa62'], 언어와표현: ['aa64'], 과학과기술: ['aa63', 'aa76'],
  인간과철학: ['aa65'], 사회와경제: ['aa66'], 글로벌문화와제2외국어: ['aa67'], 예술과체육: ['aa68'], 수리와자연: ['aa7881'],
};

class KlasError extends Error {
  constructor(code, message, extra) { super(message); this.code = code; this.extra = extra; }
}
const fail = (code, message, extra) => { throw new KlasError(code, message, extra); };

export function assertAllowed(method, url) {
  const u = new URL(url);
  const clean = u.origin + u.pathname;
  if (method === 'GET' && clean === KW_NOTICE) {
    for (const [k, v] of u.searchParams) {
      if (!KW_NOTICE_PARAMS[k]?.test(v)) fail('NOT_ALLOWED', `학교 공지 요청에 허용되지 않은 값입니다: ${k}`);
    }
    return;
  }
  const ok = method === 'POST' ? ALLOWED_POST.has(clean) && !u.search : method === 'GET' && ALLOWED_GET.some((re) => re.test(clean)) && !u.search;
  if (!ok) fail('NOT_ALLOWED', `읽기 전용 화이트리스트에 없는 요청이라 거부했습니다: ${method} ${clean}`);
}

// ---------- 설정 · 자격증명 ----------
export function readEnvFile(file) {
  try {
    return Object.fromEntries(fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/)
      .map((l) => l.match(/^\s*([\w.-]+)\s*=\s*(.*?)\s*$/)).filter(Boolean)
      .map(([, k, v]) => [k, v.replace(/^(['"])(.*)\1$/, '$2')]));
  } catch { return {}; }
}
// readEnvFile은 값 앞뒤 공백을 자르고 바깥 따옴표 한 쌍만 벗기므로, 따옴표로 감싸 쓰면 어떤 비밀번호든 그대로 읽힌다
export const envLine = (k, v) => `${k}="${v}"`;
// 일반 키(id, pw)는 KLAS_HOME의 .env와 이 스킬의 원본 저장소 루트 .env에서만 읽는다.
// npx skills 등으로 남의 프로젝트(<project>/.agents/skills/klas)에 설치되면 그 프로젝트 .env의 id/pw를 KLAS로 보내지 않는다.
export function sourceRepoRoot(dir) {
  for (const up of [3, 4]) { // <root>/skills/klas/scripts, 저장소 안 로컬 복사본 <root>/.agents|.claude/skills/klas/scripts
    const root = path.resolve(dir, ...Array(up).fill('..'));
    if (fs.existsSync(path.join(root, 'skills', 'klas', 'SKILL.md')) && fs.existsSync(path.join(root, '.claude-plugin', 'marketplace.json'))) return root;
  }
  return null;
}
const repoRoot = sourceRepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const projectEnv = repoRoot ? readEnvFile(path.join(repoRoot, '.env')) : {};
const cwdEnv = Object.fromEntries(Object.entries(readEnvFile(path.join(process.cwd(), '.env'))).filter(([k]) => k.startsWith('KLAS_')));
export const home = () => process.env.KLAS_HOME || cwdEnv.KLAS_HOME || projectEnv.KLAS_HOME || path.join(os.homedir(), '.klas-agent');
function credentials() {
  const env = { ...readEnvFile(path.join(home(), '.env')), ...projectEnv, ...cwdEnv };
  return {
    id: process.env.KLAS_ID || env.KLAS_ID || env.id,
    pw: process.env.KLAS_PW || env.KLAS_PW || env.pw,
  };
}
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return undefined; } };
function writeJson(f, data) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(data, null, 1), { mode: 0o600 });
}

// ---------- HTTP (유일한 출구) ----------
let jar = {};
const sessionFile = () => path.join(home(), 'session.json');
const loadSession = () => { jar = readJson(sessionFile())?.cookies ?? {}; };
const saveSession = () => writeJson(sessionFile(), { cookies: jar, savedAt: new Date().toISOString() });

async function http(method, url, body) {
  assertAllowed(method, url);
  const klas = url.startsWith(BASE);
  const headers = { 'User-Agent': UA };
  if (klas && Object.keys(jar).length) headers.Cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  if (method === 'POST') Object.assign(headers, { 'Content-Type': 'application/json;charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' });
  const res = await fetch(url, {
    method, headers, redirect: 'manual', signal: AbortSignal.timeout(60_000),
    body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
  });
  if (klas) {
    for (const c of res.headers.getSetCookie()) {
      const kv = c.split(';')[0];
      const i = kv.indexOf('=');
      if (i > 0) jar[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
    }
  }
  return res;
}

// 세션 없음/만료 시 KLAS는 200 JSON {redirect:true, redirectUrl:"/usr/cmn/login/LoginForm.do?..."}를 준다 (실측)
export const isExpiredJson = (j) => !!j && typeof j === 'object' && !Array.isArray(j)
  && (j.loginRequired === true || (j.redirect === true && /LoginForm/.test(j.redirectUrl ?? '')));
const isExpiredRes = (res) => res.status >= 300 && res.status < 400 && /login/i.test(res.headers.get('location') ?? '');

// ---------- 로그인 ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let loggedInThisRun = false;

// 사용자가 학번·비밀번호를 입력해야 풀리는 오류
const needsLoginPage = (e) => ['NO_CREDENTIALS', 'LOGIN_FAILED', 'LOGIN_BLOCKED'].includes(e.code);

// 로그인 페이지를 띄우고 사용자가 끝낼 때까지 명령을 끝내지 않는다.
// Antigravity처럼 명령이 끝나면 자식 프로세스까지 끄는 도구가 있어, 명령이 살아 있어야 페이지도 살아 있다
async function login(stale) {
  try {
    await loginOnce(stale);
  } catch (e) {
    if (!needsLoginPage(e)) throw e;
    if (!e.loginPage) {
      e.message += ` ${setupFallback()}`;
      throw e;
    }
    console.error(`${e.message} ${loginPageGuide(e.loginPage)}`);
    if (await waitForLogin(stale)) return;
    e.message += ` ${LOGIN_WAIT_TIMEOUT}`;
    throw e;
  }
}

// stale: 만료로 거절된 요청에 실어 보낸 SESSION. 파일의 SESSION이 이것과 다르면 다른 프로세스가 새로 로그인한 것이다
async function loginOnce(stale) {
  const lock = path.join(home(), 'login.lock');
  fs.mkdirSync(home(), { recursive: true });
  const started = Date.now();
  // 에이전트가 명령을 병렬 실행해도 비밀번호 시도는 한 번만 일어나게 잠금
  for (;;) {
    try { fs.closeSync(fs.openSync(lock, 'wx')); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let age = 0;
      try { age = Date.now() - fs.statSync(lock).mtimeMs; } catch { continue; }
      if (age > 90_000) { fs.rmSync(lock, { force: true }); continue; }
      if (Date.now() - started > 100_000) fail('LOGIN_BUSY', '다른 프로세스의 로그인이 끝나지 않았습니다.');
      await sleep(500);
    }
  }
  try {
    loadSession();
    if (jar.SESSION && jar.SESSION !== stale) return; // 기다리는 동안 다른 프로세스가 로그인함
    await doLogin();
  } catch (e) {
    if (needsLoginPage(e)) e.loginPage = await loginPageUrl(); // 병렬 명령이 페이지를 하나만 띄우도록 잠금 안에서 연다
    throw e;
  } finally { fs.rmSync(lock, { force: true }); }
}

export function encryptLoginToken(publicKey, payload) {
  const key = publicKey.includes('BEGIN') ? publicKey
    : `-----BEGIN PUBLIC KEY-----\n${publicKey.match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----`;
  return crypto.publicEncrypt({ key, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(payload)).toString('base64');
}

async function doLogin({ id, pw } = credentials()) {
  if (!id || !pw) fail('NO_CREDENTIALS', '로그인 해주세요!');
  const credHash = crypto.createHash('sha256').update(`${id}\0${pw}`).digest('hex');
  const failFile = path.join(home(), 'login-failed.json');
  const prev = readJson(failFile);
  if (prev?.credHash === credHash) {
    fail('LOGIN_BLOCKED', `사용자에게 전달: 이전 로그인이 실패했습니다(${prev.reason}). 계정 잠금(5회)을 막기 위해 같은 비밀번호로는 다시 시도하지 않습니다. `
      + `비밀번호를 새로 입력하거나, 맞는 비밀번호라면 KLAS 웹에서 로그인되는지 확인한 뒤 ${failFile} 파일을 지워야 합니다. 에이전트는 이 파일을 지우지 않습니다.`);
  }
  jar = {};
  const form = await http('GET', `${BASE}/usr/cmn/login/LoginForm.do`);
  await form.arrayBuffer();
  const sec = JSON.parse(await (await http('POST', `${BASE}/usr/cmn/login/LoginSecurity.do`, {})).text());
  if (!sec?.publicKey) fail('LOGIN_PRECHECK_FAILED', '로그인 공개키를 받지 못했습니다. 비밀번호 시도는 하지 않았습니다.');
  const loginToken = encryptLoginToken(sec.publicKey, JSON.stringify({ loginId: id, loginPwd: pw, storeIdYn: 'N' }));
  const failures = (await (await http('POST', `${BASE}/usr/cmn/login/LoginCaptcha.do`, { loginToken, captcha: '' })).text()).trim();
  if (!/^\d+$/.test(failures)) fail('LOGIN_PRECHECK_FAILED', '로그인 사전 확인 응답이 예상과 다릅니다. 비밀번호 시도는 하지 않았습니다.');
  if (Number(failures) > 2) fail('CAPTCHA_REQUIRED', `최근 로그인 실패가 ${failures}회라 캡차가 필요합니다. KLAS 웹사이트에서 직접 한 번 로그인해 주세요.`);

  const res = await http('POST', `${BASE}/usr/cmn/login/LoginConfirm.do`, { loginToken, captcha: '', redirectUrl: '', redirectTabUrl: '' });
  let r;
  try { r = JSON.parse(await res.text()); } catch { r = undefined; }
  if (!r || r.errorCount !== 0) {
    const reason = r?.fieldErrors?.[0]?.message || r?.responseText || `HTTP ${res.status}`;
    writeJson(failFile, { credHash, reason, at: new Date().toISOString() });
    fail('LOGIN_FAILED', `KLAS 로그인 실패: ${reason}. 자동 재시도는 하지 않습니다.`, { reason });
  }
  const d = r.response ?? {};
  if (d.certOpt === 'Y' || d.frstPwdAt === 'Y') fail('PASSWORD_CHANGE_REQUIRED', 'KLAS 웹에서 임시 비밀번호를 먼저 변경해야 합니다.');
  if (d.twoFactorAt === 'Y') fail('TWO_FACTOR_REQUIRED', '2차 인증이 필요한 로그인입니다. KLAS 웹에서 직접 로그인해 주세요.');
  if (d.gradAt === 'Y') fail('GRADUATED', '졸업생은 KLAS를 이용할 수 없습니다.');
  if (!jar.SESSION) fail('NO_SESSION', '로그인 응답에 세션 쿠키가 없습니다.');
  loggedInThisRun = true;
  saveSession();
}

// ---------- 로그인 웹페이지 ----------
// 비밀번호는 사용자가 브라우저에 직접 입력하므로 에이전트를 거치지 않는다
const LOGIN_PAGE_TTL = 30 * 60_000;
const SCRIPT = fileURLToPath(import.meta.url);
const loginPageFile = () => path.join(home(), 'login-page.json');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function launch(cmd, args) {
  try { spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => {}).unref(); } catch { /* 링크를 안내하므로 괜찮다 */ }
}
function openBrowser(url) {
  if (process.platform === 'win32') launch('cmd', ['/c', 'start', '', url]);
  else launch(process.platform === 'darwin' ? 'open' : 'xdg-open', [url]);
}

// 이미 떠 있는 페이지가 있으면 재사용한다
async function loginPageUrl() {
  const file = loginPageFile();
  const cur = readJson(file);
  let age = 0;
  let alive = false;
  try {
    age = Date.now() - fs.statSync(file).mtimeMs;
    alive = age < LOGIN_PAGE_TTL && process.kill(cur.pid, 0);
  } catch { /* 없거나 꺼짐 */ }
  if (alive) {
    // 병렬 명령은 몇 초 안에 몰려오므로 탭을 또 열지 않는다. 그 뒤에 다시 실행했다면 사용자가 탭을 닫았을 수 있다
    if (age > 15_000) openBrowser(cur.url);
    return cur.url;
  }
  fs.rmSync(file, { force: true });
  launch(process.execPath, [SCRIPT, 'login-page']);
  for (let i = 0; i < 50; i++) {
    await sleep(100);
    const url = readJson(file)?.url;
    if (url) return url;
  }
  return undefined;
}

const setupFallback = () => `로그인 페이지를 열지 못했습니다. 터미널에서 이 명령을 실행해 주세요: node "${SCRIPT}" setup`;
const loginPageGuide = (url) => `브라우저에 열린 로그인 페이지에서 학번과 비밀번호를 입력해 주세요. 로그인하면 하던 일을 이어서 합니다. 페이지가 안 보이면 이 링크를 여세요: ${url}`;
const LOGIN_WAIT_TIMEOUT = '아직 로그인이 끝나지 않았습니다. 사용자가 준비되면 같은 명령을 다시 실행하세요. 로그인 페이지가 다시 열립니다.';

// 사용자가 페이지에서 로그인하면 페이지 서버가 session.json을 새로 저장한다.
// 기본 100초: 흔한 에이전트 명령 제한 시간(2분)보다 먼저 끝나 에이전트가 안내할 기회를 남긴다
async function waitForLogin(stale) {
  const end = Date.now() + Number(opts.wait ?? 100) * 1000;
  while (Date.now() < end) {
    await sleep(500);
    loadSession();
    if (jar.SESSION && jar.SESSION !== stale) return true;
  }
  return false;
}

function loginErrorText(e) {
  if (e.code === 'LOGIN_FAILED') return `로그인하지 못했습니다. 학번과 비밀번호를 확인하고 다시 입력해 주세요. 여러 번 틀리면 KLAS 계정이 잠길 수 있습니다. (KLAS 응답: ${e.extra?.reason})`;
  if (e.code === 'LOGIN_BLOCKED') return `방금 실패한 것과 같은 비밀번호라서 계정이 잠기지 않도록 다시 시도하지 않았습니다. 비밀번호를 확인해 주세요. 맞는 비밀번호가 확실하면 ${path.join(home(), 'login-failed.json')} 파일을 지운 뒤 다시 눌러 주세요.`;
  if (e instanceof KlasError) return e.message;
  return `문제가 생겼습니다. 인터넷 연결을 확인하고 다시 눌러 주세요. (${e?.message ?? e})`;
}

// 컴퓨터를 잘 모르는 사용자가 불안해하지 않도록 다크 모드에서도 밝은 화면을 유지한다
const LOGIN_PAGE_STYLE = `:root{color-scheme:light;--bg:#f3f6fb;--card:#fff;--text:#1d1d1f;--sub:#6e6e73;--line:#d2d2d7;--accent:#2563eb;--on:#fff;--err:#b3261e;--err-bg:#fdecea}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:var(--bg);color:var(--text);font:16px/1.6 system-ui,'Malgun Gothic','Apple SD Gothic Neo',sans-serif}
main{width:100%;max-width:400px;padding:32px;background:var(--card);border-radius:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}
h1{margin:0 0 8px;font-size:24px}
p{margin:0}
label{display:block;margin-top:16px;font-weight:600}
input{display:block;width:100%;margin-top:6px;padding:12px;font:inherit;font-weight:400;color:inherit;background:transparent;border:1px solid var(--line);border-radius:10px}
button{width:100%;margin-top:24px;padding:14px;font:inherit;font-weight:600;color:var(--on);background:var(--accent);border:0;border-radius:10px;cursor:pointer}
button:disabled{opacity:.6}
.err{margin-top:16px;padding:12px;color:var(--err);background:var(--err-bg);border-radius:10px}
.note{margin-top:16px;font-size:13px;color:var(--sub)}`;
const pageHtml = (body) => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KLAS 로그인</title><style>${LOGIN_PAGE_STYLE}</style></head><body><main>${body}</main></body></html>`;
const loginFormHtml = ({ id = '', error } = {}) => pageHtml(`<h1>KLAS 로그인</h1>
<p>학번과 비밀번호를 한 번만 입력하면 에이전트가 KLAS 정보를 읽어 올 수 있어요.</p>
${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}
<form method="post" onsubmit="b.disabled=true;b.textContent='확인하는 중…'">
<label>학번<input name="id" value="${esc(id)}" inputmode="numeric" autocomplete="username" required autofocus></label>
<label>비밀번호<input name="pw" type="password" autocomplete="current-password" required></label>
<button id="b">로그인</button>
</form>
<p class="note">비밀번호는 이 컴퓨터에만 저장되고 KLAS 로그인에만 쓰입니다. 과제 제출이나 수강신청 같은 변경은 하지 않고 조회만 합니다.</p>
<p class="note">광운대학교 공식 사이트가 아니라, 내 컴퓨터에서 실행 중인 KLAS 에이전트 스킬 화면입니다.</p>`);
const loginDoneHtml = (overridden) => pageHtml(`<h1>로그인 완료</h1>
<p>이제 이 창을 닫고 에이전트로 돌아가세요. 하던 일을 이어서 합니다. 에이전트가 멈춰 있으면 "다 했어"라고 말해 주세요.</p>
${overridden ? '<p class="err" role="alert">환경변수 KLAS_ID/KLAS_PW나 작업 폴더의 .env에 다른 로그인 정보가 있어 그쪽이 먼저 쓰입니다.</p>' : ''}`);

function sendPage(res, status, html, onFinish) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'",
  });
  res.end(html, onFinish);
}

// 127.0.0.1에서만 열고, 주소의 임의 토큰을 모르면 열 수 없어 다른 웹사이트가 이 페이지로 제출할 수 없다
export function loginPageServer(token, { tryLogin = doLogin, onDone = () => {} } = {}) {
  let busy = false;
  const handle = async (req, res) => {
    if (req.url !== `/${token}`) return sendPage(res, 404, '');
    if (req.method !== 'POST') return sendPage(res, 200, loginFormHtml());
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 4096) return sendPage(res, 413, '');
    }
    const form = new URLSearchParams(body);
    const id = (form.get('id') ?? '').trim();
    const pw = form.get('pw') ?? '';
    if (!id || !pw) return sendPage(res, 200, loginFormHtml({ id, error: '학번과 비밀번호를 모두 입력해 주세요.' }));
    if (busy) return sendPage(res, 200, loginFormHtml({ id, error: '로그인을 확인하는 중입니다. 잠시 후 다시 눌러 주세요.' }));
    busy = true;
    try {
      await tryLogin({ id, pw }); // 실패하면 저장하지 않는다
      fs.writeFileSync(path.join(home(), '.env'), `${envLine('id', id)}\n${envLine('pw', pw)}\n`, { mode: 0o600 });
      const used = credentials();
      return sendPage(res, 200, loginDoneHtml(used.id !== id || used.pw !== pw), onDone);
    } catch (e) {
      return sendPage(res, 200, loginFormHtml({ id, error: loginErrorText(e) }));
    } finally { busy = false; }
  };
  return createServer((req, res) => { handle(req, res).catch(() => res.destroy()); });
}

// 로그인이 필요한 요청. 만료되면 한 실행에서 최대 1번만 재로그인한다.
async function authed(method, url, body) {
  if (!jar.SESSION) loadSession();
  if (!jar.SESSION) await login();
  for (let tries = 0; ; tries++) {
    const sent = jar.SESSION; // 만료 응답도 Set-Cookie로 새 SESSION을 주므로 보낸 값을 따로 기억한다
    const res = await http(method, url, body);
    const type = res.headers.get('content-type') ?? '';
    let json;
    let text;
    if (method === 'POST' || type.includes('json')) { // GET 본문(파일·HTML)은 호출한 쪽이 읽는다
      text = await res.text();
      try { json = text.trim() ? JSON.parse(text) : null; } catch { json = undefined; }
    }
    if (isExpiredRes(res) || isExpiredJson(json)) {
      // 횟수 상한: 재로그인 판단이 틀려도 학교 서버에 같은 요청을 무한히 보내지 않게 한다
      if (loggedInThisRun || tries >= 2) fail('SESSION_EXPIRED', '로그인 직후에도 세션이 인정되지 않습니다.');
      await login(sent);
      continue;
    }
    if (!res.ok) fail(`HTTP_${res.status}`, `${url} 요청이 실패했습니다.`);
    return { res, json, text };
  }
}

async function api(p, body = {}, { allowEmpty = false } = {}) {
  const { json, text } = await authed('POST', BASE + p, body);
  // 공학교육 API는 대상이 아니거나 데이터가 없으면 빈 본문을 준다
  if (json === undefined && !(allowEmpty && !(text ?? '').trim())) fail('BAD_RESPONSE', `${p}가 JSON이 아닌 응답을 줬습니다.`, { head: (text ?? '').slice(0, 120) });
  return json;
}

// ---------- 공통 유틸 ----------
export function compact(v) {
  if (Array.isArray(v)) return v.map(compact);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) {
      if (k.includes('(')) continue; // "nvl(bunban" 같은 SQL 잔여 키
      const c = compact(x);
      if (c === null || c === undefined || c === '' || (Array.isArray(c) && !c.length)
        || (c && typeof c === 'object' && !Array.isArray(c) && !Object.keys(c).length)) continue;
      o[k] = c;
    }
    return o;
  }
  return typeof v === 'string' ? v.trim() : v;
}

// KLAS 시각은 KST 문자열. 초가 없으면 :59 (KLAS Helper와 같은 해석)
export function parseKst(s) {
  const m = String(s ?? '').match(/(\d{4})\D(\d{1,2})\D(\d{1,2})(?:\D+(\d{1,2})\D(\d{2})(?:\D(\d{2}))?)?/);
  if (!m) return NaN;
  const [y, mo, d, h, mi, se] = m.slice(1).map((x) => (x === undefined ? undefined : Number(x)));
  return Date.UTC(y, mo - 1, d, h ?? 23, mi ?? 59, se ?? 59) - 9 * 3600_000;
}
export const fmtKst = (ms) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');

export function safeName(name) {
  let n = String(name ?? '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 150);
  if (!n) n = 'file';
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(n)) n = `_${n}`;
  return n;
}

const stripHtml = (h) => String(h ?? '').replace(/<(style|script)[\s\S]*?<\/\1>/gi, '').replace(/<(br|\/p|\/div|\/li|\/tr)[^>]*>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  .replace(/\r/g, '').replace(/[ \t]*\n[ \t]*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

// ---------- 학교 대표 공지 (www.kw.ac.kr, 로그인 불필요) ----------
const htmlText = (h) => stripHtml(String(h ?? '').replace(/<span class=["']ico-[^"']*["'][^>]*>[\s\S]*?<\/span>/g, '')).replace(/\s+/g, ' ').trim();
const absKw = (href) => new URL(href.replace(/&amp;/g, '&'), 'https://www.kw.ac.kr').href;

export function parseKwNoticeList(html) {
  const box = html.slice(html.indexOf('board-list-box'), html.indexOf('</ul>', html.indexOf('board-list-box')));
  return [...box.matchAll(/<li([^>]*)>([\s\S]*?)<\/li>/g)].map(([, attrs, li]) => {
    const duid = li.match(/DUID=(\d+)/)?.[1];
    const category = htmlText(li.match(/<strong class='category'>([\s\S]*?)<\/strong>/)?.[1]);
    const title = htmlText(li.match(/<a [^>]*>([\s\S]*?)<\/a>/)?.[1]?.replace(/<strong class='category'>[\s\S]*?<\/strong>/, ''));
    const info = htmlText(li.match(/<p class="info">([\s\S]*?)<\/p>/)?.[1]);
    return {
      id: duid, category, title, pinned: /top-notice/.test(attrs) || undefined, hasFile: /ico-file/.test(li) || undefined,
      views: info.match(/조회수\s*(\d+)/)?.[1], date: info.match(/작성일\s*([\d.-]+)/)?.[1], updated: info.match(/수정일\s*([\d.-]+)/)?.[1],
      author: info.split('|').pop()?.trim(), url: duid ? `${KW_NOTICE}?BoardMode=view&DUID=${duid}` : undefined,
    };
  }).filter((x) => x.id);
}

export function parseKwNotice(html) {
  const box = html.slice(html.indexOf('board-view-box'));
  const end = box.indexOf('paging-btns');
  const body = box.slice(box.indexOf('<li class="contents">'), end < 0 ? undefined : box.lastIndexOf('<', end));
  return {
    title: htmlText(box.match(/<p class="title">([\s\S]*?)<\/p>/)?.[1]?.replace(/<strong class="category">[\s\S]*?<\/strong>/, '')),
    category: htmlText(box.match(/<strong class="category">([\s\S]*?)<\/strong>/)?.[1]),
    info: htmlText(box.match(/<p class="info">([\s\S]*?)<\/p>/)?.[1]),
    files: [...(box.match(/<li class="attachment">([\s\S]*?)<\/li>/)?.[1] ?? '').matchAll(/<a href='([^']+)'>([\s\S]*?)<\/a>/g)]
      .map(([, href, name]) => ({ name: htmlText(name), url: absKw(href) })),
    content: stripHtml(body),
    images: [...body.matchAll(/<img[^>]+src="([^"]+)"/g)].map(([, s]) => absKw(s)),
  }; // 페이지 하단 '담당부서'는 홈페이지 관리부서라 넣지 않음. 공지 작성 부서는 info 끝에 있다
}

// ---------- 학기 · 과목 ----------
let termsCache;
let opts = {};
const terms = async () => (termsCache ??= await api('/std/cmn/frame/YearhakgiAtnlcSbjectList.do'));
async function currentTerm() {
  const t = await terms();
  if (!opts.term) return t[0];
  return t.find((x) => x.value === opts.term) ?? fail('TERM_NOT_FOUND', `학기 ${opts.term}가 없습니다.`, { terms: t.map((x) => x.value) });
}
const toCourse = (term, s) => ({ term, code: s.value, name: s.name, label: s.label });

export function matchCourses(list, query) {
  const norm = (s) => String(s ?? '').replace(/\s/g, '').toLowerCase();
  const exact = list.filter((s) => s.code === query || norm(s.name) === norm(query));
  return exact.length ? exact : list.filter((s) => norm(s.name).includes(norm(query)) || norm(s.label).includes(norm(query)));
}

async function courses(query, { required = false } = {}) {
  const t = await currentTerm();
  const all = t.subjList.map((s) => toCourse(t.value, s));
  if (!query) {
    if (required) fail('COURSE_REQUIRED', '과목 이름을 지정해 주세요.', { courses: all.map((c) => c.name) });
    return all;
  }
  const hits = matchCourses(all, query);
  if (!hits.length) fail('COURSE_NOT_FOUND', `'${query}' 과목이 이번 학기에 없습니다.`, { courses: all.map((c) => c.name) });
  if (hits.length > 1 && required) fail('COURSE_AMBIGUOUS', `'${query}'에 맞는 과목이 여러 개입니다.`, { courses: hits.map((c) => c.name) });
  return hits;
}
const one = async (q) => (await courses(q, { required: true }))[0];
const ctx = (c) => ({ selectYearhakgi: c.term, selectSubj: c.code, selectChangeYn: 'Y' });

// ---------- 로컬 저장소 (기억 · 자료) ----------
const courseDir = (c, ...sub) => path.join(home(), c.term.replace(',', '-'), safeName(c.name), ...sub);
const memoryFile = (c) => (c ? courseDir(c, 'MEMORY.md') : path.join(home(), 'MEMORY.md'));
function readMemory(c) {
  try {
    const t = fs.readFileSync(memoryFile(c), 'utf8');
    return /^\s*-\s+\S/m.test(t) ? t : undefined; // 항목이 하나라도 있을 때만
  } catch { return undefined; }
}
const listDir = (d) => { try { return fs.readdirSync(d).filter((f) => !f.startsWith('.')); } catch { return []; } };

// 과목별로 같은 엔드포인트를 조회. 목록 API는 본문의 과목 코드를 따르므로 병렬 호출해도 된다(KLAS Helper 실사용 근거)
const perCourse = (endpoint, map = (x) => x, extra = {}) => async ([q]) => Promise.all((await courses(q)).map(async (c) => ({
  course: c.name, items: map(await api(endpoint, { ...ctx(c), ...extra }), c), memory: readMemory(c),
})));

async function boardList(boardKey, [q], withFiles = false) {
  const page = Math.max(1, Number(opts.page ?? 1)) - 1;
  return Promise.all((await courses(q)).map(async (c) => {
    const r = await api(`/std/lis/sport/${BOARDS[boardKey]}/BoardStdList.do`, { ...ctx(c), currentPage: page });
    const items = (r?.list ?? []).map((x) => ({
      boardNo: x.boardNo, masterNo: x.masterNo, title: x.title, author: x.userNm, date: x.registDt, views: x.readCnt,
      fileCount: x.fileCnt, attachId: x.fileCnt ? x.atchFileId : undefined, category: x.categoryNm,
    }));
    if (withFiles) {
      for (const it of items) if (it.attachId) it.files = await fileList(it.attachId);
    }
    return { course: c.name, page: (r?.page?.currentPage ?? page) + 1, totalPages: r?.page?.totalPages, items };
  }));
}

async function fileList(attachId) {
  const files = await api('/common/file/UploadFileList.do', { attachId, storageId: 'CLS_BOARD' });
  return (files ?? []).map((f) => ({ attachId: f.attachId, fileSn: f.fileSn, fileName: f.fileName, size: f.fileSize }));
}

async function downloadTo(dir, f, manifest) {
  if (!/^[\w-]{1,100}$/.test(f.attachId ?? '') || !/^\d{1,6}$/.test(String(f.fileSn))) fail('BAD_FILE_ID', '첨부파일 식별자가 올바르지 않습니다.');
  const key = `${f.attachId}:${f.fileSn}`;
  if (manifest[key] && fs.existsSync(path.join(dir, manifest[key].file))) return { file: manifest[key].file, skipped: true };
  const { res } = await authed('GET', `${BASE}/common/file/DownloadFile/${f.attachId}/${f.fileSn}`);
  if ((res.headers.get('content-type') ?? '').includes('text/html')) fail('DOWNLOAD_FAILED', `${f.fileName} 다운로드가 HTML 응답을 받았습니다.`);
  const data = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(dir, { recursive: true });
  let name = safeName(f.fileName);
  if (fs.existsSync(path.join(dir, name))) {
    const ext = path.extname(name);
    name = `${path.basename(name, ext)} (${String(f.attachId).slice(-6)}-${f.fileSn})${ext}`;
  }
  const tmp = path.join(dir, `.${name}.part`);
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, path.join(dir, name));
  manifest[key] = { file: name, size: data.length, at: new Date().toISOString() };
  return { file: name, skipped: false };
}

// fs.cpSync는 Node 24 Windows에서 한글 경로의 기존 폴더를 덮어쓸 때 프로세스가 죽는다(0xC0000409, 실측) → 직접 복사
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.name === '.env') continue;
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

// ---------- 명령 ----------
const taskDue = (t, now) => {
  let due = parseKst(t.expiredate);
  let late = false;
  if (due < now && t.reexpiredate) { due = parseKst(t.reexpiredate); late = true; }
  return { due, late };
};

const commands = {
  async profile() {
    const r = await api('/std/cps/inqire/AtnlcScreHakjukInfo.do');
    const { cultureHakjum, majorHakjum, generalHakjum, prevHakjumNum, ...rest } = r ?? {};
    return { ...rest, 편입인정학점: { 교양: cultureHakjum, 전공: majorHakjum, 일반선택: generalHakjum, 계: prevHakjumNum } };
  },

  async semesters() {
    return (await terms()).map((t) => ({ term: t.value, label: t.label, courses: t.subjList.map((s) => ({ code: s.value, name: s.name, label: s.label })) }));
  },

  async advisor() {
    const t = await currentTerm();
    return (await api('/std/cmn/frame/StdHome.do', { searchYearhakgi: t.value }))?.rspnsblProfsr;
  },

  async courses() {
    const t = await currentTerm();
    const r = await api('/std/cmn/frame/StdHome.do', { searchYearhakgi: t.value });
    return { term: t.value, courses: r?.atnlcSbjectList, recent: r?.subjNotiList };
  },

  async timetable() {
    const [year, hakgi] = (await currentTerm()).value.split(',');
    return api('/std/cps/atnlc/TimetableStdList.do', { searchYear: year, searchHakgi: hakgi });
  },

  async course([q]) {
    const c = await one(q);
    const home = await api('/std/lis/evltn/LctrumHomeStdInfo.do', ctx(c));
    for (const n of home?.noticeList ?? []) n.content = stripHtml(n.content);
    return { course: c.name, home, memory: readMemory(c) };
  },

  async syllabus([q]) {
    const c = /^U\d{5}/.test(q ?? '') ? { code: q, name: q } : await one(q);
    const body = { selectSubj: c.code };
    const [plan, time, outcomes, prerequisites] = await Promise.all(
      ['LectrePlanData', 'LectreTimeInfo', 'LectrePlanInputTabFourgrid', 'LectreBeforeGwamok'].map((e) => api(`/std/cps/atnlc/${e}.do`, body)),
    );
    const p = { ...(plan?.[0] ?? {}) };
    p.evaluationType = EVALUATION_TYPES[p.evaluationOpt];
    const weeks = [];
    for (let i = 1; i <= 16; i++) {
      weeks.push({ week: i, plan: p[`week${i}Lecture`], note: p[`week${i}Bigo`], substitute: p[`week${i}Subs`] });
      delete p[`week${i}Lecture`]; delete p[`week${i}Bigo`]; delete p[`week${i}Subs`];
    }
    return { course: c.name, plan: p, weeks, time, outcomes, prerequisites, memory: c.term ? readMemory(c) : undefined };
  },

  async 'syllabus-search'([q]) {
    // KLAS 화면은 '전체' 검색에 과목명·교수명을 요구하지만, 서버는 학과만 넣어도 그 학과 목록을 준다(실측).
    // 사용자 결정으로 학과 단위 목록은 허용하고, 학교 전체 목록(조건 없음)은 막는다.
    if (!q && !opts.prof && !opts.dept) fail('QUERY_REQUIRED', '과목명, --prof 교수명, --dept 학과 중 하나는 지정해 주세요.');
    let year, hakgi;
    if (opts.term) { // 수강신청 준비용: 아직 듣지 않은 다음 학기도 검색하므로 수강 학기 목록과 대조하지 않는다
      if (!/^\d{4},[1-4]$/.test(opts.term)) fail('BAD_TERM', '--term은 2027,1 형식입니다 (1학기 1, 2학기 2, 여름 3, 겨울 4).');
      [year, hakgi] = opts.term.split(',');
    } else [year, hakgi] = (await currentTerm()).value.split(',');
    const body = {
      selectYear: Number(year), selecthakgi: Number(hakgi), selectYearHakgi: `${year},${hakgi}`, selectRadio: 'all',
      selectText: q ?? '', selectProfsr: opts.prof ?? '', cmmnGamok: '', selecthakgwa: '', selectMajor: '',
    };
    if (opts.dept) {
      const norm = (s) => String(s ?? '').replace(/\s/g, '');
      const depts = (await api('/std/cps/atnlc/CmmnHakgwaList.do', body)) ?? [];
      const hit = depts.filter((d) => d.classCode === opts.dept || norm(d.openMajorName).includes(norm(opts.dept)));
      if (hit.length !== 1) fail(hit.length ? 'DEPT_AMBIGUOUS' : 'DEPT_NOT_FOUND', `학과 '${opts.dept}'를 하나로 정하지 못했습니다.`,
        { candidates: (hit.length ? hit : depts).map((d) => ({ code: d.classCode, name: d.openMajorName })) });
      body.selecthakgwa = hit[0].classCode;
    }
    const rows = ((await api('/std/cps/atnlc/LectrePlanStdList.do', body)) ?? []).map((x) => ({
      ...x, syllabusCode: `U${x.thisYear}${x.hakgi}${x.openGwamokNo}${x.openMajorCode}${x.bunbanNo}${x.openGrade}`,
    }));
    if (opts.time) { // 과목마다 LectreTimeInfo 1회. 학교 서버 부담을 줄이려고 동시에 4개까지만
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(4, rows.length) }, async () => {
        while (next < rows.length) {
          const r = rows[next++];
          r.slots = ((await api('/std/cps/atnlc/LectreTimeInfo.do', { selectSubj: r.syllabusCode })) ?? []).flatMap((t) => Object.keys(t)
            .filter((k) => /^dayname\d+$/.test(k))
            .map((k) => ({ day: t[k], period: t[`timeNo${k.slice(7)}`], room: t.locHname })));
        }
      }));
    }
    return rows;
  },

  assignments: perCourse('/std/lis/evltn/TaskStdList.do'),

  async assignment([q, ordseq]) {
    const c = await one(q);
    // TaskStdView는 본문의 과목을 무시하고 직전 TaskStdList가 세션에 남긴 과목을 쓴다 (klax 실측) → 순서대로 호출 후 검증
    const list = await api('/std/lis/evltn/TaskStdList.do', ctx(c));
    const t = (list ?? []).find((x) => String(x.ordseq) === String(ordseq));
    if (!t) fail('TASK_NOT_FOUND', `${c.name}에 ordseq ${ordseq} 과제가 없습니다.`, { tasks: (list ?? []).map((x) => ({ ordseq: x.ordseq, title: x.title })) });
    const detail = (await api('/std/lis/evltn/TaskStdView.do', { ...ctx(c), ordseq: t.ordseq, taskNo: t.taskNo }))?.rpt;
    if (!detail || detail.title !== t.title) fail('TASK_MISMATCH', '요청한 과제와 다른 응답이 와서 결과를 버렸습니다.');
    detail.contents = stripHtml(detail.contents);
    const files = detail.atchFileId ? await fileList(detail.atchFileId) : [];
    return { course: c.name, detail, files, memory: readMemory(c) };
  },

  videos: perCourse('/std/lis/evltn/SelectOnlineCntntsStdList.do', (rows) => (rows ?? []).map((v) => ({
    week: v.weekNo, type: v.evltnSe, module: v.moduletitle, title: v.sbjt, start: v.startDate, end: v.endDate,
    progress: v.prog, required: v.rcognTime, learned: v.achivTime, length: v.totalTime, online: v.isonoff,
    link: /^https?:\/\//.test(v.starting ?? '') ? v.starting : undefined, // 대면 수업 행은 'default.htm' 같은 값이라 뺀다
  }))),
  quizzes: perCourse('/std/lis/evltn/AnytmQuizStdList.do'),
  exams: perCourse('/std/lis/evltn/OnlineTestStdList.do'),
  projects: perCourse('/std/lis/evltn/PrjctStdList.do'),
  discussions: perCourse('/std/lis/evltn/DscsnStdList.do'),

  attendance: perCourse('/std/lis/evltn/LrnSttusStdAtendList.do', (rows) => {
    const recorded = (rows ?? []).filter((r) => r.attendancedivLabel && r.attendancedivLabel !== '-');
    const counts = {};
    for (const r of recorded) {
      const name = ATTENDANCE_LABELS[r.attendancedivLabel] ?? r.attendancedivLabel;
      counts[name] = (counts[name] ?? 0) + 1;
    }
    return {
      counts, recorded: recorded.length,
      rate: recorded.length ? Math.round(((counts.출석 ?? 0) / recorded.length) * 1000) / 10 : undefined, // KLAS+ 방식(출석÷기록)
      sessions: recorded.map((r) => `${r.weeklyseq}주-${r.weeklysubseq}:${ATTENDANCE_LABELS[r.attendancedivLabel] ?? r.attendancedivLabel}`),
    };
  }),

  async grades() {
    const [semesters, totals] = await Promise.all([api('/std/cps/inqire/AtnlcScreSungjukInfo.do'), api('/std/cps/inqire/AtnlcScreSungjukTot.do')]);
    return { semesters, totals };
  },
  ranking: () => api('/std/cps/inqire/StandStdList.do'),
  scholarships: () => api('/std/cps/inqire/JanghakHistoryStdList.do'),

  async graduation() {
    if (opts.check) {
      const r = await api('/std/ext/grdtn/SelectGraduateCheck.do', { info: '' });
      return r || { status: '졸업예정자 명단에 없음 (졸업 대상 학기에만 조회됨)' };
    }
    const page = await (await authed('GET', `${BASE}/std/cps/inqire/GyoyangIsuStdPage.do`)).res.text();
    // 학교가 해마다 파일을 바꿔 걸므로(sungjuk_info_2025.pdf 등) 이름을 고정하지 않고 화면의 링크를 모두 읽는다
    const rulesPaths = [...new Set([...page.matchAll(/href="(\/assets\/custom\/doc\/[\w.-]+\.pdf)"/g)].map((m) => m[1]))];
    if (opts.rules) {
      if (!rulesPaths.length) fail('RULES_NOT_FOUND', '졸업기준표 링크를 찾지 못했습니다.');
      const files = [];
      for (const p of rulesPaths) {
        const { res } = await authed('GET', BASE + p);
        const file = path.join(home(), 'graduation', safeName(path.basename(p)));
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
        files.push(file);
      }
      return { rulesPdfs: files };
    }
    const [program, credits, gy, info] = await Promise.all([
      api('/std/cps/inqire/AtnlcScreProgramGubun.do'), api('/std/cps/inqire/AtnlcScreSungjukTot.do'),
      api('/std/cps/inqire/GyoyangIsuInfo.do'), api('/std/cps/inqire/AtnlcScreHakjukInfo.do'),
    ]);
    const areas = Object.fromEntries(Object.entries(GYOYANG_AREAS).map(([k, codes]) => [k, codes.reduce((s, c) => s + (gy?.[c] ?? 0), 0)]));
    const mapped = new Set(Object.values(GYOYANG_AREAS).flat());
    // 교양 체계가 바뀌어 새 영역 코드가 생기면(예: 2026학번 AI리터러시·기초학문융합) 여기로 드러난다
    const unknownCodes = Object.fromEntries(Object.entries(gy ?? {}).filter(([k]) => /^aa\d+$/.test(k) && !mapped.has(k)));
    const admissionYear = Number(String(info?.hakbun ?? '').slice(0, 4)) || undefined; // 학번 자체는 내보내지 않는다
    const pdfYear = Math.max(...rulesPaths.map((p) => Number(p.match(/(\d{4})\.pdf$/)?.[1]) || 0));
    return {
      student: { 구분: info?.gubun, 학과: info?.hakgwa, 학년: info?.grade, 학적: info?.hakjukStatu, 입학연도: admissionYear },
      program, credits,
      liberalArts: { areas, total: Object.values(areas).reduce((a, b) => a + b, 0), unknownCodes },
      rulesPdfs: rulesPaths.map((p) => `${BASE}${p}`),
      rulesWarning: admissionYear && pdfYear > 0 && admissionYear > pdfYear
        ? `KLAS 졸업기준표(${pdfYear})에 ${admissionYear}학번 행이 없을 수 있습니다. references/graduation.md의 학교 홈페이지 기준을 확인하세요.` : undefined,
    };
  },

  async engineering() {
    const person = await api('/std/egn/chck/LrnRsltPersonCheck.do', {}, { allowEmpty: true });
    if (!person?.pgmNo) return { program: null, message: '공학인증 대상 학생이 아닙니다 (KLAS 공학교육 기준).' };
    const t = await currentTerm();
    const [year, hakgi] = t.value.split(',');
    const [pgm, isu, exist] = await Promise.all([
      api('/std/egn/chck/LrnRsltPgmCheck.do', {}, { allowEmpty: true }),
      api('/std/egn/chck/IsuCheck.do', { thisYear: year, hakgi, pgmNo: person.pgmNo }),
      api('/std/egn/chck/LrnRsltgetExistYn.do', { pgmNo: person.pgmNo }, { allowEmpty: true }),
    ]);
    let outcomes = '학과가 아직 학습성과 평가를 입력하지 않았습니다(졸업 전에 학과가 입력). 졸업기준은 KLAS [공학교육] → [공학프로그램 학습성과 점검]에서 본다.';
    if (Number(exist) > 0) {
      const g = await api('/std/egn/chck/LrnRsltGraduInfo.do', { pgmNo: person.pgmNo }, { allowEmpty: true }) ?? {};
      const label = { P: 'PASS', F: 'FAIL', I: 'INCOMPLETE' };
      outcomes = Array.from({ length: 20 }, (_, i) => i + 1).filter((i) => g[`evalTool${i}`] != null)
        .map((i) => ({ no: i, tool: g[`evalTool${i}`], standard: g[`graduStd${i}`], result: label[g[`evalPass${i}`]] }));
    }
    return {
      program: { code: person.pgmNo, name: person.pgmName, certOpt: pgm?.certOpt },
      prerequisites: {
        term: t.value,
        message: isu?.stats ? undefined : isu?.returnMsg,
        // 학번·교번·휴대전화는 버린다. prerequisite가 없으면 선수 지정 과목이 없는 과목이다
        courses: (isu?.info ?? []).map((x) => ({
          course: x.afterGwamokKname, professor: x.memberName,
          prerequisite: x.beforeGwamokKname ? { name: x.beforeGwamokKname, completed: x.beforeIsu === 'Y', approved: x.approveOpt === 'Y' } : undefined,
        })),
      },
      outcomes,
      klasOnly: [
        '개인별 공학인증 졸업 심사서(이수학점·학습성과·설계): KLAS [공학교육] → [공학프로그램 이수현황 점검]. 보고서 뷰어라 스크립트로 읽지 못한다',
        '학과별 선후수 지정 교과목 목록: KLAS [공학교육] → [선수교과목 이수현황 조회] → [선수교과목 이수 지정교과목 조회]',
        '드림캐처 이수체계 준수 점검: http://dream.kw.ac.kr',
      ],
      guide: 'https://klas.kw.ac.kr/html/cert_change/cert_change_info2023.pdf (선·후수 교과목 이수체계 준수제도 안내, 2023)',
    };
  },

  notices: (a) => boardList('notice', a),
  qna: (a) => boardList('qna', a),
  materials: (a) => boardList('materials', a, true),
  'student-materials': (a) => boardList('student', a, true),

  async post([q, board, boardNo, masterNo]) {
    if (!BOARDS[board]) fail('BAD_BOARD', `게시판은 ${Object.keys(BOARDS).join(', ')} 중 하나입니다.`);
    if (!/^\d+$/.test(boardNo ?? '') || !/^\d+$/.test(masterNo ?? '')) fail('BAD_ARGS', 'post <과목> <게시판> <boardNo> <masterNo>');
    const c = await one(q);
    const r = await api(`/std/lis/sport/${BOARDS[board]}/BoardStdView.do`, {
      cmd: 'select', ...ctx(c), boardNo: Number(boardNo), masterNo: Number(masterNo), storageId: 'CLS_BOARD',
    });
    const { registerIp, updusrIp, registerInfo, updusrInfo, ...b } = r?.board ?? {}; // 작성자 IP 등은 버림
    b.content = stripHtml(b.content);
    return { course: c.name, post: b, files: b.atchFileId ? await fileList(b.atchFileId) : undefined, memory: readMemory(c) };
  },

  async download([q, attachId, fileSn]) {
    const c = await one(q);
    const files = await fileList(attachId);
    const f = files.find((x) => String(x.fileSn) === String(fileSn)) ?? fail('FILE_NOT_FOUND', '해당 첨부파일이 없습니다.', { files });
    const dir = courseDir(c, 'materials');
    const mf = path.join(dir, '.manifest.json');
    const manifest = readJson(mf) ?? {};
    const r = await downloadTo(dir, f, manifest);
    writeJson(mf, manifest);
    return { path: path.join(dir, r.file), skipped: r.skipped };
  },

  async sync([q]) {
    const results = [];
    for (const c of await courses(q)) {
      const dir = courseDir(c, 'materials');
      const mf = path.join(dir, '.manifest.json');
      const manifest = readJson(mf) ?? {};
      const added = [];
      let skipped = 0;
      for (let page = 0, total = 1; page < total && page < 20; page++) {
        const r = await api(`/std/lis/sport/${BOARDS.materials}/BoardStdList.do`, { ...ctx(c), currentPage: page });
        total = r?.page?.totalPages ?? 1;
        for (const post of r?.list ?? []) {
          if (!post.fileCnt) continue;
          for (const f of await fileList(post.atchFileId)) {
            const d = await downloadTo(dir, f, manifest);
            if (d.skipped) skipped++; else { added.push(d.file); writeJson(mf, manifest); }
          }
        }
      }
      results.push({ course: c.name, dir, added, skipped });
    }
    return results;
  },

  async alerts() {
    const page = Math.max(1, Number(opts.page ?? 1)) - 1;
    return api('/mst/sys/optrn/SelectPushMsgHisList.do', { pageInit: page === 0, currentPage: page, list: [], page: {} });
  },

  async calendar([ym]) {
    const now = new Date(Date.now() + 9 * 3600_000);
    const [y, m] = (ym ?? '').match(/^(\d{4})-(\d{1,2})$/)?.slice(1).map(Number) ?? [now.getUTCFullYear(), now.getUTCMonth() + 1];
    const r = await api('/std/cmn/frame/SchdulStdList.do', { schdulYear: y, schdulMonth: m });
    return { month: `${y}-${String(m).padStart(2, '0')}`, events: r?.tableList };
  },

  async 'academic-calendar'() {
    const html = await (await http('GET', PUBLIC_CALENDAR)).text();
    const year = html.match(/<h3>(\d{4}) CALENDAR<\/h3>/)?.[1];
    const section = html.slice(html.indexOf('schedule-this-yearlist'));
    const items = [...section.matchAll(/<strong>([\s\S]*?)<\/strong>\s*<p>([\s\S]*?)<\/p>/g)]
      .map(([, d, t]) => ({ date: stripHtml(d).replace(/\s+/g, ' '), title: stripHtml(t) }));
    return { year, source: PUBLIC_CALENDAR, items };
  },

  async 'kw-notices'([query]) {
    const u = new URL(KW_NOTICE);
    const cat = opts.category ? KW_NOTICE_CATEGORIES[opts.category] : '';
    if (cat === undefined) fail('BAD_CATEGORY', `분류는 ${Object.keys(KW_NOTICE_CATEGORIES).join(', ')} 중 하나입니다.`);
    u.searchParams.set('srCategoryId', String(cat));
    u.searchParams.set('tpage', String(Math.max(1, Number(opts.page ?? 1))));
    if (query) { u.searchParams.set('mode', 'list'); u.searchParams.set('searchKey', '1'); u.searchParams.set('searchVal', query); }
    const res = await http('GET', u.href);
    if (!res.ok) fail(`HTTP_${res.status}`, '학교 공지 목록을 불러오지 못했습니다.');
    return { source: u.href, items: parseKwNoticeList(await res.text()) };
  },

  async 'kw-notice'([id]) {
    if (!/^\d{1,10}$/.test(id ?? '')) fail('BAD_ARGS', 'kw-notice <공지 id>');
    const url = `${KW_NOTICE}?BoardMode=view&DUID=${id}`;
    const res = await http('GET', url);
    if (!res.ok) fail(`HTTP_${res.status}`, '학교 공지를 불러오지 못했습니다.');
    return { url, ...parseKwNotice(await res.text()) };
  },

  async memory([q]) {
    const c = q ? await one(q) : undefined;
    const file = memoryFile(c);
    if (!fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, c ? `# ${c.name} (${c.term.replace(',', '-')})\n\n## 시험\n\n## 기타\n` : '# KLAS 기억 (과목 무관)\n\n## 나\n\n');
    }
    if (c) fs.mkdirSync(courseDir(c, 'my'), { recursive: true });
    return {
      path: file, content: fs.readFileSync(file, 'utf8'),
      myDir: c ? courseDir(c, 'my') : undefined, myFiles: c ? listDir(courseDir(c, 'my')) : undefined,
      materials: c ? listDir(courseDir(c, 'materials')).length : undefined,
    };
  },

  async todo([q]) {
    const now = Date.now();
    const items = [];
    await Promise.all((await courses(q)).map(async (c) => {
      const [tasks, videos, projects, quizzes, exams] = await Promise.all([
        ...['TaskStdList', 'SelectOnlineCntntsStdList', 'PrjctStdList'].map((e) => api(`/std/lis/evltn/${e}.do`, ctx(c))),
        // 퀴즈·시험 목록은 과목에 따라 실패하기도 함 (KLAS Helper와 동일 처리)
        ...['AnytmQuizStdList', 'OnlineTestStdList'].map((e) => api(`/std/lis/evltn/${e}.do`, ctx(c)).catch(() => [])),
      ]);
      for (const [kind, list] of [['과제', tasks], ['팀프로젝트', projects]]) {
        for (const t of list ?? []) {
          if (t.submityn === 'Y') continue;
          const { due, late } = taskDue(t, now);
          if (due >= now) items.push({ kind, course: c.name, title: t.title, due, late: late || undefined, ordseq: t.ordseq });
        }
      }
      for (const v of videos ?? []) {
        if (v.evltnSe !== 'lesson' || v.prog >= 100 || v.isonoff === 'OFF' || parseKst(v.startDate) > now) continue;
        const due = parseKst(v.endDate);
        if (due >= now) items.push({ kind: '영상', course: c.name, title: v.sbjt || v.moduletitle, week: v.weekNo, due, progress: v.prog, required: v.rcognTime, learned: v.achivTime });
      }
      // 필드 이름은 KLAS Helper(issubmit·edt)와 KLAS+(submityn·sdates·edates·papernm) 코드 근거. 이번 학기 실데이터로는 미확인
      for (const [kind, list] of [['퀴즈', quizzes], ['온라인시험', exams]]) {
        for (const z of list ?? []) {
          if (z.issubmit === 'Y' || z.submityn === 'Y') continue;
          const due = parseKst(z.edates ?? z.edt ?? z.edate ?? z.expiredate);
          if (due >= now) items.push({ kind, course: c.name, title: z.papernm ?? z.title, due });
        }
      }
    }));
    items.sort((a, b) => a.due - b.due);
    return items.map((i) => ({ ...i, due: fmtKst(i.due), hoursLeft: Math.floor((i.due - now) / 3600_000) }));
  },

  async setup() {
    loadSession();
    const before = jar.SESSION;
    const url = await loginPageUrl();
    if (!url) fail('LOGIN_PAGE_FAILED', `${setupFallback()} 터미널에서도 안 되면 ${path.join(home(), '.env')} 파일에 id=학번, pw=비밀번호 두 줄을 직접 적어 주세요.`);
    console.error(loginPageGuide(url));
    if (!await waitForLogin(before)) fail('LOGIN_WAIT_TIMEOUT', LOGIN_WAIT_TIMEOUT);
    console.log('로그인했습니다.');
  },

  // 로그인 페이지가 필요할 때 백그라운드로 뜨는 서버. 로그인에 성공하거나 30분이 지나면 꺼진다
  async 'login-page'() {
    const token = crypto.randomBytes(24).toString('hex');
    const server = loginPageServer(token, { onDone: () => process.exit() });
    await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
    const url = `http://127.0.0.1:${server.address().port}/${token}`;
    writeJson(loginPageFile(), { pid: process.pid, url });
    process.on('exit', () => fs.rmSync(loginPageFile(), { force: true }));
    setTimeout(() => process.exit(), LOGIN_PAGE_TTL);
    openBrowser(url);
  },

  install() {
    const src = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
    const h = os.homedir();
    const targets = opts.global
      ? [
        [path.join(h, '.agents', 'skills'), h], // Codex · opencode 공용
        [path.join(h, '.claude', 'skills'), path.join(h, '.claude')],
        [path.join(h, '.gemini', 'config', 'skills'), path.join(h, '.gemini')],
        [path.join(h, '.gemini', 'antigravity-cli', 'skills'), path.join(h, '.gemini', 'antigravity-cli')],
      ]
      : [[path.join(process.cwd(), '.agents', 'skills'), process.cwd()], [path.join(process.cwd(), '.claude', 'skills'), process.cwd()]];
    const done = [];
    for (const [dir, needs] of targets) {
      const dest = path.join(dir, 'klas');
      // npx skills는 에이전트 폴더를 ~/.agents/skills/klas로 잇는 링크(Windows는 junction)로 만들므로 실제 경로로 비교한다
      if (!fs.existsSync(needs) || (fs.existsSync(dest) && fs.realpathSync(dest) === fs.realpathSync(src))) continue;
      copyDir(src, dest);
      done.push(dest);
    }
    return { installed: done };
  },
};

// ---------- 진입점 ----------
const VALUE_FLAGS = new Set(['term', 'page', 'prof', 'category', 'dept', 'wait']);
export function parseArgs(argv) {
  const pos = [];
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const [k, v] = a.slice(2).split(/=(.*)/s);
    o[k] = v ?? (VALUE_FLAGS.has(k) ? argv[++i] : true);
  }
  return { pos, opts: o };
}

async function main() {
  const { pos, opts: o } = parseArgs(process.argv.slice(2));
  opts = o;
  const [cmd, ...args] = pos;
  if (!cmd || !commands[cmd]) {
    console.log(JSON.stringify({ error: 'UNKNOWN_COMMAND', commands: Object.keys(commands) }));
    process.exitCode = cmd ? 1 : 0;
    return;
  }
  try {
    const out = await commands[cmd](args);
    if (out !== undefined) console.log(JSON.stringify(compact(out), null, 1)); // setup은 안내문을 직접 출력한다
  } catch (e) {
    const known = e instanceof KlasError;
    const sys = e?.cause?.code ?? e?.code;
    // 샌드박스(예: Codex)에서 네트워크·홈 폴더 쓰기가 막힌 경우를 구분해 알려준다
    const code = known ? e.code
      : e?.name === 'TimeoutError' ? 'TIMEOUT'
        : ['EPERM', 'EACCES', 'EROFS'].includes(sys) ? 'STORAGE_DENIED'
          : /fetch failed/i.test(e?.message ?? '') || ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET'].includes(sys) ? 'NETWORK' : 'UNEXPECTED';
    const hint = { STORAGE_DENIED: `${home()}에 쓸 수 없습니다. 샌드박스라면 이 경로를 쓰기 허용하거나 KLAS_HOME을 작업 폴더 안으로 지정하세요.`,
      NETWORK: 'klas.kw.ac.kr에 연결하지 못했습니다. 샌드박스라면 네트워크 접근을 허용해야 합니다.' }[code];
    console.log(JSON.stringify({ error: code, message: known ? e.message : `${hint ?? ''} ${String(e?.message ?? e)}`.trim(), ...(known ? e.extra : {}) }, null, 1));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
