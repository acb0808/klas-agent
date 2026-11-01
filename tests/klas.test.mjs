// node --test 로 실행. 네트워크·로그인 없이 안전장치와 파서만 검사한다.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertAllowed, compact, encryptLoginToken, isExpiredJson, matchCourses, parseArgs, parseKst, fmtKst, safeName, parseKwNoticeList, parseKwNotice, sourceRepoRoot, readEnvFile, envLine, loginPageServer } from '../skills/klas/scripts/klas.mjs';

test('자격증명: 남의 프로젝트에 설치되면 그 .env의 id/pw를 쓰지 않는다', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'klas-'));
  try {
    const mk = (...p) => fs.mkdirSync(path.join(tmp, ...p), { recursive: true });
    // npx skills 프로젝트 설치 형태: <project>/.agents/skills/klas/scripts + <project>/.env
    mk('other', '.agents', 'skills', 'klas', 'scripts');
    fs.writeFileSync(path.join(tmp, 'other', '.env'), 'id=admin\npw=secret\n');
    assert.equal(sourceRepoRoot(path.join(tmp, 'other', '.agents', 'skills', 'klas', 'scripts')), null);
    // 원본 저장소: <root>/skills/klas + <root>/.claude-plugin/marketplace.json, 저장소 안 로컬 복사본도 같은 루트
    mk('repo', 'skills', 'klas', 'scripts');
    mk('repo', '.claude-plugin');
    mk('repo', '.claude', 'skills', 'klas', 'scripts');
    fs.writeFileSync(path.join(tmp, 'repo', 'skills', 'klas', 'SKILL.md'), '');
    fs.writeFileSync(path.join(tmp, 'repo', '.claude-plugin', 'marketplace.json'), '{}');
    assert.equal(sourceRepoRoot(path.join(tmp, 'repo', 'skills', 'klas', 'scripts')), path.join(tmp, 'repo'));
    assert.equal(sourceRepoRoot(path.join(tmp, 'repo', '.claude', 'skills', 'klas', 'scripts')), path.join(tmp, 'repo'));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('학교 공지: 정해진 쿼리만 허용', () => {
  assertAllowed('GET', 'https://www.kw.ac.kr/ko/life/notice.jsp?srCategoryId=4&tpage=2');
  assertAllowed('GET', 'https://www.kw.ac.kr/ko/life/notice.jsp?srCategoryId=&tpage=1&mode=list&searchKey=1&searchVal=%EC%9E%A5%ED%95%99');
  assertAllowed('GET', 'https://www.kw.ac.kr/ko/life/notice.jsp?BoardMode=view&DUID=53579');
  for (const u of [
    'https://www.kw.ac.kr/ko/life/notice.jsp?BoardMode=write',
    'https://www.kw.ac.kr/ko/life/notice.jsp?DUID=abc',
    'https://www.kw.ac.kr/ko/life/notice.jsp?tpage=1&evil=1',
    'https://www.kw.ac.kr/ko/life/other.jsp?tpage=1',
    'https://www.kw.ac.kr/KWBoard/list5_detail.jsp?x=1',
  ]) assert.throws(() => assertAllowed('GET', u), /화이트리스트|허용/, u);
  assert.throws(() => assertAllowed('POST', 'https://www.kw.ac.kr/ko/life/notice.jsp'), /화이트리스트/);
});

test('학교 공지 목록·본문 파싱', () => {
  const list = `<div class="board-list-box"><ul><li class="top-notice "><div class="board-text">
    <a href="/ko/life/notice.jsp?BoardMode=view&DUID=53579&tpage=1"><strong class='category'>[장학]</strong> 2학기 장학 신청 <span class="ico-new">신규게시글</span><span class="ico-file ">Attachment</span></a>
    <p class="info">조회수 136 | 작성일 2026-10-28 | 수정일 2026-10-29 | 학생복지팀</p></div></li></ul></div>`;
  assert.deepEqual(parseKwNoticeList(list), [{ id: '53579', category: '[장학]', title: '2학기 장학 신청', pinned: true, hasFile: true, views: '136',
    date: '2026-10-28', updated: '2026-10-29', author: '학생복지팀', url: 'https://www.kw.ac.kr/ko/life/notice.jsp?BoardMode=view&DUID=53579' }]);
  const view = `<div class="board-view-box"><ul><li class="title"><p class="title"><strong class="category">[장학] </strong>제목 <span class="ico-new">New</span></p>
    <p class="info">조회수 1 | 작성일 2026.10.28</p></li><li class="attachment"><p><a href='/include/Download.jsp?fuid=1&ano=2'><span class='ico-file'>Attachment</span>신청서.hwp</a></p></li>
    <li class="contents"><style>.x{color:red}</style><p>마감 <b>11월 10일</b></p><img src="https://x.kw.ac.kr/a.png"></li></ul></div><div class="paging-btns">다음글</div>`;
  const v = parseKwNotice(view);
  assert.equal(v.title, '제목');
  assert.equal(v.content, '마감 11월 10일');
  assert.deepEqual(v.files, [{ name: '신청서.hwp', url: 'https://www.kw.ac.kr/include/Download.jsp?fuid=1&ano=2' }]);
  assert.deepEqual(v.images, ['https://x.kw.ac.kr/a.png']);
});

test('화이트리스트: 쓰기·우회 엔드포인트와 임의 경로는 거부', () => {
  for (const [m, u] of [
    ['POST', 'https://klas.kw.ac.kr/std/ads/admst/MySchdulSave.do'],
    ['POST', 'https://klas.kw.ac.kr/std/ads/admst/MySchdulDelete.do'],
    ['POST', 'https://klas.kw.ac.kr/mst/ads/admst/KwAttendQRCodeInsert.do'],
    ['POST', 'https://klas.kw.ac.kr/std/lis/evltn/CertiStdCheck.do'],
    ['GET', 'https://klas.kw.ac.kr/spv/lis/lctre/viewer/LctreCntntsViewSpvPage.do'],
    ['POST', 'https://klas.kw.ac.kr/std/egn/chck/LrnRsltGraduNew.do'], // 쓰기 여부 불분명
    ['POST', 'https://klas.kw.ac.kr/spv/cmn/reprt/GraduateKecStd.do'], // 보고서 서버
    ['POST', 'https://klas.kw.ac.kr/std/egn/cnslt/SuhakPlanSave.do'],
    ['POST', 'https://klas.kw.ac.kr/anything.do'],
    ['GET', 'https://klas.kw.ac.kr/std/lis/evltn/TaskStdList.do'], // 조회 API라도 메서드가 다르면 거부
    ['POST', 'https://evil.example/std/lis/evltn/TaskStdList.do'],
    ['POST', 'https://klas.kw.ac.kr/std/lis/evltn/TaskStdList.do?x=1'],
    ['GET', 'https://klas.kw.ac.kr/common/file/DownloadFile/../../x/1'],
    ['DELETE', 'https://klas.kw.ac.kr/std/lis/evltn/TaskStdList.do'],
  ]) assert.throws(() => assertAllowed(m, u), /NOT_ALLOWED|화이트리스트/, `${m} ${u}`);
});

test('화이트리스트: 조회 API는 허용', () => {
  assertAllowed('POST', 'https://klas.kw.ac.kr/std/lis/evltn/TaskStdList.do');
  assertAllowed('POST', 'https://klas.kw.ac.kr/std/cps/atnlc/CmmnHakgwaList.do'); // 강의계획서 검색 --dept용 학과 목록
  assertAllowed('POST', 'https://klas.kw.ac.kr/std/egn/chck/IsuCheck.do'); // 공학인증 선수과목 이수현황
  assertAllowed('POST', 'https://klas.kw.ac.kr/std/lis/sport/6972896bfe72408eb72926780e85d041/BoardStdList.do');
  assertAllowed('GET', 'https://klas.kw.ac.kr/common/file/DownloadFile/abc-123/1');
  assertAllowed('GET', 'https://www.kw.ac.kr/KWBoard/list5_detail.jsp');
});

test('세션 만료 응답 판별 (실측 형태)', () => {
  assert.equal(isExpiredJson({ redirect: true, redirectUrl: '/usr/cmn/login/LoginForm.do?redirectUrl=/x' }), true);
  assert.equal(isExpiredJson({ loginRequired: true }), true);
  assert.equal(isExpiredJson([{ redirect: true }]), false);
  assert.equal(isExpiredJson({ list: [] }), false);
});

test('KST 시각 파싱', () => {
  assert.equal(fmtKst(parseKst('2026-11-09 23:59')), '2026-11-09 23:59');
  assert.equal(fmtKst(parseKst('2026-11-09 08:05:00')), '2026-11-09 08:05');
  assert.equal(fmtKst(parseKst('2026.11.09')), '2026-11-09 23:59');
  assert.ok(Number.isNaN(parseKst(null)));
});

test('파일 이름 정리', () => {
  assert.equal(safeName('../../a/b.pdf'), '_.._a_b.pdf');
  assert.equal(safeName('CON.txt'), '_CON.txt');
  assert.equal(safeName('  ..  '), 'file');
  assert.equal(safeName('강의자료: 9장?.pdf'), '강의자료_ 9장_.pdf');
});

test('compact는 빈 값과 SQL 잔여 키를 지운다', () => {
  assert.deepEqual(compact({ a: null, b: '', c: [], d: {}, e: 0, 'nvl(x': 'y', f: { g: null, h: ' t ' } }), { e: 0, f: { h: 't' } });
});

test('과목 매칭: 정확 일치 우선, 공백·대소문자 무시', () => {
  const list = [{ code: 'U1', name: '자료구조', label: '' }, { code: 'U2', name: '고급자료구조', label: '' }, { code: 'U3', name: 'C프로그래밍', label: '' }];
  assert.deepEqual(matchCourses(list, '자료구조').map((c) => c.code), ['U1']);
  assert.deepEqual(matchCourses(list, 'c 프로').map((c) => c.code), ['U3']);
  assert.deepEqual(matchCourses(list, 'U2').map((c) => c.code), ['U2']);
});

test('인자 파싱', () => {
  assert.deepEqual(parseArgs(['todo', '--term', '2026,1', '--global', 'x', '--page=2']), { pos: ['todo', 'x'], opts: { term: '2026,1', global: true, page: '2' } });
  assert.deepEqual(parseArgs(['syllabus-search', '자료', '--dept', '전자', '--time']), { pos: ['syllabus-search', '자료'], opts: { dept: '전자', time: true } });
});

test('로그인 토큰: PKCS#1 v1.5로 암호화되어 개인키로 복호화된다', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const b64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64'); // KLAS가 주는 형태
  const token = encryptLoginToken(b64, '{"loginId":"a"}');
  const plain = crypto.privateDecrypt({ key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(token, 'base64'));
  assert.equal(plain.toString(), '{"loginId":"a"}');
});

test('로그인 페이지가 쓴 .env는 어떤 비밀번호든 그대로 읽힌다', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'klas-'));
  try {
    for (const pw of ['plain', ' 앞뒤 공백 ', '"quoted"', "'single'", 'a=b#c', 'a"b\'c', '한글비번!@#$%']) {
      const file = path.join(tmp, '.env');
      fs.writeFileSync(file, `${envLine('id', '2026000000')}\n${envLine('pw', pw)}\n`);
      assert.deepEqual(readEnvFile(file), { id: '2026000000', pw });
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('로그인 페이지: 토큰이 틀리면 거부하고, 로그인에 성공해야만 저장한다', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'klas-'));
  const prevHome = process.env.KLAS_HOME;
  process.env.KLAS_HOME = tmp;
  let done = 0;
  const tried = [];
  const tryLogin = async ({ pw }) => {
    tried.push(pw);
    if (pw === 'wrong') throw Object.assign(new Error('x'), { code: 'LOGIN_FAILED', extra: { reason: '<b>틀림</b>' } });
  };
  const server = loginPageServer('tok', { tryLogin, onDone: () => { done++; } });
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  t.after(() => {
    server.close();
    if (prevHome === undefined) delete process.env.KLAS_HOME; else process.env.KLAS_HOME = prevHome;
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (url, form) => fetch(url, { method: 'POST', body: new URLSearchParams(form) });
  const env = path.join(tmp, '.env');

  assert.equal((await fetch(`${base}/`)).status, 404);
  assert.equal((await post(`${base}/nope`, { id: '2026000000', pw: 'x' })).status, 404);
  assert.deepEqual(tried, []);
  assert.match(await (await fetch(`${base}/tok`)).text(), /type="password"/);

  assert.match(await (await post(`${base}/tok`, { id: ' ', pw: 'x' })).text(), /모두 입력/);
  assert.deepEqual(tried, []);

  const failed = await (await post(`${base}/tok`, { id: '"><x', pw: 'wrong' })).text();
  assert.match(failed, /&#60;b&#62;틀림/); // KLAS 응답과 입력값은 HTML로 해석되지 않는다
  assert.ok(!failed.includes('"><x'));
  assert.equal(fs.existsSync(env), false);
  assert.equal(done, 0);

  const pw = ' a"b\'c&=+ 한글 ';
  assert.match(await (await post(`${base}/tok`, { id: '2026000000', pw })).text(), /로그인 완료/);
  assert.deepEqual(readEnvFile(env), { id: '2026000000', pw });
  assert.equal(done, 1);
});

test('setup은 페이지 서버를 하나만 띄우고, 로그인될 때까지 기다린다', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'klas-'));
  const script = path.join(import.meta.dirname, '..', 'skills', 'klas', 'scripts', 'klas.mjs');
  // PATH를 비워 브라우저 여는 명령만 실패하게 한다. 테스트 중에 브라우저가 뜨지 않는다
  const env = { ...process.env, KLAS_HOME: tmp, PATH: '', Path: '' };
  const pageUrl = (text) => text.match(/http:\/\/127\.0\.0\.1:\d+\/\w+/)?.[0];
  const run = () => spawnSync(process.execPath, [script, 'setup', '--wait=0'], { env, encoding: 'utf8' });
  let page;
  try {
    const first = run();
    assert.equal(JSON.parse(first.stdout).error, 'LOGIN_WAIT_TIMEOUT');
    const url = pageUrl(first.stderr);
    assert.ok(url);
    page = JSON.parse(fs.readFileSync(path.join(tmp, 'login-page.json'), 'utf8'));
    assert.equal(pageUrl(run().stderr), url);
    assert.equal((await fetch(url)).status, 200);

    const waiting = spawn(process.execPath, [script, 'setup', '--wait=30'], { env, stdio: ['ignore', 'ignore', 'pipe'] });
    const exited = new Promise((r) => { waiting.on('exit', r); });
    await new Promise((r) => { waiting.stderr.once('data', r); }); // 안내가 나왔으면 기다리기 시작한 것이다
    fs.writeFileSync(path.join(tmp, 'session.json'), JSON.stringify({ cookies: { SESSION: 'new' } })); // 페이지 서버가 로그인 성공 때 쓰는 파일
    assert.equal(await exited, 0);
  } finally {
    if (page) process.kill(page.pid);
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
