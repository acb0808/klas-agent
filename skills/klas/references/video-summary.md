# 강의 영상 요약 매뉴얼

"3주차 강의 요약해줘"처럼 영상 내용이 필요한 요청에 따른다. 사용자 컴퓨터에 무엇이 있느냐에 따라 되는 범위가 다르다. **Whisper가 없어도 요약을 멈추지 않는다.** 되는 데까지 요약하고 빠진 것을 밝힌다.

지키는 것:

- 영상은 `videos`의 `link`와 거기서 이어지는 주소로만 본다. KLAS 뷰어(`LctreCntntsViewSpvPage.do`)와 학습 인증은 열지 않는다.
- 여기서 봐도 출석으로 인정되지 않는다. `progress`가 100 미만이고 `end` 전이면 출석은 KLAS에서 `required`분 이상 직접 봐야 한다고 덧붙인다.
- 영상·음성 파일은 디스크에 저장하지 않는다.
- 음성을 외부 변환 서비스로 보내지 않는다. 글은 `my/`에만 둔다.

## 1. 환경별로 되는 것

| 있는 것 | 학교 서버 영상 | YouTube 영상 |
|---|---|---|
| Whisper(`ffmpeg` 포함) + 브라우저 도구 | 화면, 말한 내용 | 화면, 자동 자막 |
| Whisper(`ffmpeg` 포함) | 화면, 말한 내용 | 못 봄 |
| 브라우저 도구 (`ffmpeg`는 있어도 없어도 됨) | 화면 | 화면, 자동 자막 |
| `ffmpeg`만 | 화면 | 못 봄 |
| 모두 없음 | 못 봄 | 못 봄 |

어느 환경이든 강의자료(`materials/`)와 사용자의 필기·녹취록(`my/`)으로는 요약할 수 있다. 영상을 못 봤으면 `link`를 주고 영상은 보지 못했다고 밝힌다.

`ffmpeg -version`과 `whisper --help`가 실행되면 그 도구가 있는 것이다. `ffmpeg`로 뽑은 화면은 에이전트가 이미지 파일을 읽을 수 있어야 보인다. 읽을 수 없으면 브라우저 도구로 보고, 그것도 없으면 화면은 못 본다고 밝힌다.

## 2. 순서

1. `videos <과목>`으로 그 주 영상을 찾는다. 한 주에 영상이 여러 개면 모두 본다.
2. `memory <과목>`의 경로 옆 `my/`에 그 영상을 글로 바꾼 파일이 있으면 그것을 읽는다. 다시 변환하지 않는다.
3. `link` 페이지의 HTML에 `youtube.com/embed/<id>`가 있으면 §3, 없으면 학교 서버 영상이므로 §4를 따른다.
4. 강의자료와 합쳐 요약하고, 무엇을 보고 만들었는지와 빠진 것을 쉬운 말로 밝힌다.

## 3. YouTube 영상

`https://www.youtube.com/watch?v=<id>`를 브라우저 도구로 열고, 설명을 펼쳐 '스크립트 표시'를 누르면 자동 자막 전문을 읽을 수 있다. 로그인은 필요 없다. 자막 주소를 직접 요청하면 응답이 비어 있어서 브라우저 도구가 있어야 한다. 자동 자막이라 틀린 낱말이 있을 수 있음을 밝힌다.

## 4. 학교 서버 영상

### 영상 주소

`https://kwcommons.kw.ac.kr/viewer/ssplayer/uniplayer_support/content.php?content_id=<link의 id>`를 열어 첫 `<media_uri>`를 쓴다. 주소에 `[MEDIA_FILE]`이 있으면 `<main_media>` 값으로 바꾼다.

### 화면: `ffmpeg`

`ffmpeg`가 있으면 이것으로 뽑는다. 재생 버튼과 인트로 없이 위치마다 1장이 바로 나온다(50분 강의 8장에 약 8초).

```bash
ffmpeg -nostdin -loglevel error -y -ss <초> -i "<영상 주소>" -frames:v 1 -vf scale=1024:-2 -q:v 3 "<임시 폴더>/<초>.jpg"
```

위치마다 실행하되 한 번의 명령으로 묶어서 돌린다. 글자가 작아 안 읽히면 그 위치만 `scale` 없이 다시 뽑는다. 이미지는 장수만큼 토큰을 쓰니 필요한 만큼만 읽고, 다 보면 임시 폴더를 지운다.

### 화면: 브라우저 도구

`ffmpeg`가 없거나 뽑은 이미지를 읽을 수 없을 때 쓴다. `link` 뒤에 `?st=<초>`를 붙여 열면 그 위치부터 재생된다. 재생 버튼을 누르고 학교 인트로가 끝나야 넘어간다. 여러 위치를 볼 때는 인트로가 끝난 뒤 페이지의 `video.currentTime`을 바꾸면 다시 열지 않아도 된다. 페이지에 `<video>`가 여러 개이니 `currentSrc`가 `ssmovie.mp4`나 `screen.mp4`인 요소를 쓴다. 재생 중이면 스크린샷이 실패할 수 있어 `video.pause()`한 뒤 찍는다.

### 어느 위치를 볼까

슬라이드가 언제 바뀌는지는 알 수 없으므로 1~2분 간격으로 본다. 애니메이션 때문에 내용이 비어 보이면 조금 뒤 위치를 다시 본다. 본 위치 사이의 내용은 빠져 있으니 일부만 봤다고 밝힌다.

### 말한 내용 (Whisper)

학교 서버 영상에는 자막 파일이 없어서 사용자 컴퓨터의 Whisper로 글로 바꾼다.

1. 시작 전에 걸리는 시간을 알린다(§6의 시간). 처음 한 번은 모델 약 1.6GB를 받는다.
2. 영상 주소를 바로 넘겨 실행한다. 스트리밍으로 변환하므로 영상·음성 파일이 디스크에 남지 않는다. 영상을 먼저 받지 않는다. 영상이 여러 개면 영상마다 따로 실행한다. 오래 걸리니 백그라운드로 돌리고 끝까지 기다린다.
   ```bash
   whisper "<영상 주소>" --model turbo --language ko --output_format txt --output_dir "<my 폴더>" --verbose False
   ```
3. 결과 파일 이름은 `ssmovie.txt`나 `screen.txt`로 늘 같아서 다음 변환이 덮어쓴다. 끝나면 바로 `<주차>주차 <title>.txt`(`videos`의 `title`)로 바꾼다.
4. Whisper는 사람 이름과 숫자를 자주 틀린다. 답에 넣는 이름·숫자·배점은 화면으로 확인해 고치고, 화면에 없거나 화면을 볼 수 없으면 받아쓰기로만 확인했다고 밝힌다.

## 5. Whisper가 없을 때

1. 먼저 강의자료와 화면으로 되는 데까지 요약한다. 화면만 봤다고 밝히고, 말로 설명한 내용까지 봤다고 하지 않는다.
2. 말한 내용이 빠졌다고 알리고 쓸 수 있는 길을 쉬운 말로 말한다.
   - 사용자가 만든 녹취록(클로바노트 등)을 그 과목의 `my/` 폴더에 넣어 주면 읽는다. 사용자가 찾을 수 있게 폴더 위치를 그대로 알려 준다.
   - Whisper를 설치한다(§6). 디스크와 시간이 꽤 들고, 컴퓨터에 따라 어려울 수 있다고 함께 말한다.
   - 화면도 못 봤으면 `ffmpeg`만 설치하는 길도 말한다(§6의 순서 1번, 약 120MB).
3. 사용자가 설치를 원하지 않으면 다시 권하지 않는다.

## 6. Whisper 설치 (사용자가 원할 때만)

전역 Python을 바꾸는 일이므로 먼저 묻는다. 코딩을 모르는 사용자가 많으니 묻는 말에 명령어를 넣지 않고 에이전트가 실행한다. 권한 문제로 직접 못 하면 그때 명령을 코드 블록으로 준다.

실제로 돌려 본 환경은 Windows + NVIDIA GPU 메모리 6GB뿐이다. 다른 환경에서 막히면 무엇이 막혔는지 그대로 말하고 §5로 돌아간다.

**필요한 것**

| 항목 | 디스크 | 비고 |
|---|---|---|
| Python | | `python --version`으로 확인. 없으면 https://www.python.org/downloads/ |
| ffmpeg | 약 120MB | Whisper가 음성을 읽을 때와 화면을 뽑을 때 쓴다 |
| `torch` | NVIDIA GPU용 약 4.3GB | Whisper가 함께 설치한다. GPU용은 아래 2번을 먼저 한다 |
| Whisper | 약 2MB | |
| `turbo` 모델 | 약 1.6GB | 처음 실행할 때 받는다 |

**걸리는 시간**

| 장치 | 50분 강의 |
|---|---|
| NVIDIA GPU 메모리 6GB | 10~15분 |
| CPU 6코어 | 약 70분 (2분 구간을 재서 환산) |

변환 중에는 `turbo`가 GPU 메모리를 약 6GB 쓴다. 쓰지 않을 때는 디스크만 차지한다.

**순서**

1. ffmpeg를 설치한다.
   ```bash
   winget install Gyan.FFmpeg
   ```
   macOS는 `brew install ffmpeg`, Ubuntu는 `sudo apt install ffmpeg`. 설치 후 새 터미널을 열어야 인식될 수 있다.
2. NVIDIA GPU가 있으면 https://pytorch.org/get-started/locally/ 에서 환경에 맞는 CUDA용 `torch` 설치 명령을 찾아 먼저 실행한다.
3. Whisper를 설치한다.
   ```bash
   python -m pip install -U openai-whisper
   ```
4. 확인한다. 두 번째 명령이 `True`면 GPU를 쓴다.
   ```bash
   whisper --help
   ```
   ```bash
   python -c "import torch; print(torch.cuda.is_available())"
   ```

## 7. 문제 해결

| 증상 | 할 일 |
|---|---|
| `Numba needs NumPy ...` | `python -m pip install -U numba` |
| GPU 메모리 부족(`CUDA out of memory`) | GPU를 쓰는 다른 프로그램을 닫거나 `--model small`로 다시 실행한다. `small`은 약 0.5GB를 따로 받고 정확도가 더 낮을 수 있다 |
| `whisper` 명령을 찾지 못함 | `whisper` 대신 `python -m whisper`로 실행한다 |
| ffmpeg를 찾지 못함 | ffmpeg를 설치하고 새 터미널에서 다시 실행한다 |
