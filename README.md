# 🚀 실시간 탐구 학습지 생성기 (i wanna Dash ⛷️)

> **Vite와 Firebase SDK v10 및 Google Gemini AI를 활용한 실시간 탐구 활동지 생성 및 모니터링 플랫폼**  
> 교사가 웹 시뮬레이션(GeoGebra, PhET 등)과 탐구 질문을 연동하여 실시간으로 학습지를 생성하고, 학생의 제출 데이터를 실시간 대시보드와 Gemini AI 피드백을 통해 통합 관리하는 솔루션입니다.

---

## 🌟 주요 기능

1. **실시간 학습지 생성 및 연동**:
   - 외부 웹 시뮬레이션 URL(GeoGebra, PhET, Scratch 등) 연동 또는 단일 HTML 파일 업로드 방식 지원.
   - 주관식/객관식 맞춤형 탐구 질문 설계 및 교사용 고유 ID 설정 가능.
2. **학생용 실시간 탐구/필기 및 제출**:
   - 시뮬레이션 위에 오버레이된 캔버스 드로잉(펜/지우개/투명도/두께 조절) 기능 제공.
   - Screen Capture API(화면/탭 캡처) 및 html2canvas 기반 자동 캡처 첨부, 최대 500KB의 개별 파일 업로드 기능 지원.
   - 복사/붙여넣기 횟수 및 텍스트 세그먼트 기록을 통한 표절/치팅 실시간 모니터링.
3. **교사용 실시간 모니터링 대시보드**:
   - Firestore 실시간 리스너(`onSnapshot`)를 활용한 실시간 제출 현황(학번순 정렬).
   - 비정상적인 답안 복사-붙여넣기 이력 감지 및 하이라이트 표시.
   - 전체 학생 제출 데이터의 엑셀 호환 CSV 리포트 다운로드(UTF-8 BOM으로 한글 깨짐 방지) 및 데이터 안전 초기화.
4. **Google Gemini AI 연동 피드백**:
   - Cloud Functions를 통해 `gemini-1.5-flash` 모델을 호출하여, 학생의 관찰/추론 내용에 맞는 1~2문장의 발문형 힌트 피드백 실시간 전송.

---

## 📖 간결한 사용법 (Quick Start)

### 🏫 교사용 (수업 생성 및 모니터링)
1. **로그인**: `Google 로그인`을 완료하여 수업 관리 권한을 확보합니다.
2. **방 만들기**: 시뮬레이션 정보(웹 주소 또는 HTML 파일) 및 탐구 질문을 입력하고 고유 ID를 지정하여 **`방(url) 만들기`**를 누릅니다.
3. **공유 및 모니터링**: 
   - 생성된 **학생 접속 링크/QR**을 학생들에게 공유합니다.
   - **교사용 모니터링 링크**로 진입하여 학생들의 제출 현황과 그리기 캡처, AI 피드백, 외부 복사 이력을 실시간으로 모니터링합니다.
4. **수업 종료**: **`CSV 다운로드`**를 클릭하여 최종 결과 리포트를 저장하고, 다음 수업을 위해 **`데이터 초기화`**를 수행합니다.

### 🙋‍♂️ 학생용 (탐구 수행 및 제출)
1. **접속**: 교사가 공유한 링크나 QR 코드를 통해 입장한 후 학번과 이름을 입력합니다.
2. **탐구 및 필기**:
   - **`🖱️ 조작`** 모드: 시뮬레이션을 조작하며 실험을 진행합니다.
   - **`✏️ 펜`** 모드: 색상, 두께, 투명도를 설정하여 시뮬레이션 화면 위에 직접 선과 메모를 그립니다.
3. **답안 작성 및 캡처**:
   - 주관식/객관식 질문에 대한 답안을 작성합니다.
   - 시뮬레이션의 특정 순간을 남기려면 **`📸 화면 캡처`**를 누르거나 관련 참고 파일을 파일 업로드로 첨부합니다.
4. **제출**: **`답안 제출`**을 클릭하면 작성한 내용과 드로잉 캡처가 제출되며, 즉시 나타나는 **`🤖 AI 피드백 힌트`**를 참고하여 탐구를 심화합니다.

---

## 🛠️ 기술 스택 및 프로젝트 구조

### Technology Stack
- **Frontend**: HTML5, Vanilla CSS, JS (ES Modules)
- **Build Tool**: Vite
- **Database / Auth**: Firebase SDK v10 (Firestore, Authentication)
- **Serverless Backend**: Firebase Cloud Functions (v2)
- **AI Engine**: Google Gemini API (`gemini-1.5-flash`)
- **Libraries**: `html2canvas` (화면 캡처), `qrcode` (QR 코드 생성)

### Project Directory Structure
```bash
├── .env                       # 프론트엔드 Firebase 환경 변수 설정
├── index.html                 # 교사 메인화면 (수업방 생성 및 관리)
├── student.html               # 학생 탐구 화면
├── teacherMonitor.html        # 교사 실시간 모니터링 대시보드 화면
├── vite.config.js             # Vite 빌드 설정 파일
├── src/
│   ├── firebaseConfig.js      # Firebase 및 Google Auth 초기화 설정
│   ├── index.js               # 교사 페이지 주요 JS 비즈니스 로직
│   ├── main.js                # 학생 페이지 주요 JS 비즈니스 로직
│   ├── admin.js               # 실시간 모니터링 대시보드 JS 로직
│   └── styles.css             # 모던 UI를 위한 Vanilla CSS 스타일 가이드
├── functions/
│   ├── .env                   # Cloud Functions용 GEMINI_API_KEY
│   ├── index.js               # getAiHint Cloud Function (Gemini 호출 및 제출 자동 기록)
│   ├── package.json           # Cloud Functions 종속성 설정
│   └── package-lock.json
└── package.json               # 루트 프로젝트 메타데이터 및 스크립트
```

---

## 🚀 로컬 개발 및 실행 방법

### 1. 종속성 설치
```bash
# 루트 프로젝트 종속성 설치
npm install

# Cloud Functions 폴더 종속성 설치
cd functions
npm install
cd ..
```

### 2. 환경 변수 구성
- 루트 경로의 `.env` 파일에 Firebase 웹 프로젝트 설정을 채웁니다:
  ```env
  VITE_FIREBASE_API_KEY=your_api_key
  VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
  VITE_FIREBASE_PROJECT_ID=your_project_id
  VITE_FIREBASE_STORAGE_BUCKET=your_project.firebasestorage.app
  VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
  VITE_FIREBASE_APP_ID=your_app_id
  ```
- `functions/.env` 파일에 Google Gemini API Key를 추가합니다:
  ```env
  GEMINI_API_KEY=your_gemini_api_key_here
  ```

### 3. 로컬 서버 실행
```bash
# 로컬 개발 서버 구동 (기본 포트: 5173)
npm run dev
```

---

## 🌐 배포 가이드

### Firebase Hosting & Functions 배포
1. Firebase CLI 로그인 및 프로젝트 설정:
   ```bash
   npx firebase login
   npx firebase use --add [your-firebase-project-id]
   ```
2. 배포 진행:
   ```bash
   # 정적 리소스 빌드 및 배포
   npm run build
   npx firebase deploy --only hosting,functions
   ```
