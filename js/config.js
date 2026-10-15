// ===== 앱 전체에서 쓰는 상수 =====

export const APP_VERSION = 'v0.3.2';

// ===== 저장소 =====
export const DB_NAME = 'kiln-recorder';
export const DB_VERSION = 1;
export const PREF_LAST_KILN_ID = 'kilnRecorder.lastKilnId';     // 마지막에 선택한 가마 id
export const PREF_LAST_OPERATOR = 'kilnRecorder.lastOperator';  // 마지막 작업자 이름
export const PREF_LAST_BACKUP_AT = 'kilnRecorder.lastBackupAt'; // 마지막 백업 시각
// 이전 버전(v0.1)이 localStorage에 저장하던 가마 설정 (처음 한 번 IndexedDB로 옮김)
export const LEGACY_KEY_KILNS = 'kilnReader.kilns';
export const LEGACY_KEY_LAST = 'kilnReader.lastKiln';

// ===== 가마 설정 기본값 =====
export const MAX_NAME_LENGTH = 30;
export const DEFAULT_DIGITS = 4;
export const MIN_DIGITS = 1;
export const MAX_DIGITS = 6;
export const READ_INTERVAL_OPTIONS = [3, 5, 10, 15, 20, 30]; // 판독 주기 선택지 (초, 1분 안에 여러 번 읽도록 30초 이하)
export const DEFAULT_READ_INTERVAL_SEC = 5;
export const DEFAULT_POLARITY = 'bright';     // 'bright'(밝은 숫자) | 'dark'(어두운 숫자)
export const THRESHOLD_OFFSET_LIMIT = 100;    // 임계값 보정 범위 (±)
export const SHEAR_LIMIT = 20;                // 기울기 보정 범위 (±도)
export const DEFAULT_SEG_ON_RATIO = 0.4;      // 세그먼트 켜짐 기준 (켜진 픽셀 비율)
export const MIN_SEG_ON_RATIO = 0.1;
export const MAX_SEG_ON_RATIO = 0.9;

// ===== 카메라 =====
export const CAMERA_IDEAL_W = 1920;    // 후면 카메라 요청 해상도 (지원하지 않으면 해상도 조건 없이 다시 요청)
export const CAMERA_IDEAL_H = 1080;

// ===== 영역(ROI) 지정 화면: 고정된 가이드 틀 + 영상 확대/이동 =====
export const DEFAULT_DIGIT_ASPECT = 0.6;     // 자릿수 한 칸의 폭/높이 비율 (틀 비율 = 자릿수 × 이 값)
export const MIN_DIGIT_ASPECT = 0.3;
export const MAX_DIGIT_ASPECT = 1.2;
export const GUIDE_WIDTH_RATIO = 0.7;        // 틀 폭 = 영상 영역 폭의 70%
export const GUIDE_MAX_HEIGHT_RATIO = 0.9;   // 틀 높이는 영상 영역 높이의 90%를 넘지 않게
export const MIN_ZOOM = 1;                   // 디지털 확대 배율 범위
export const MAX_ZOOM = 10;
export const ZOOM_STEP = 1.25;               // [+] [-] 버튼 한 번에 바뀌는 배율
export const ROI_COLOR = '#ffd400';    // 틀 테두리 색 (밝은/어두운 영상 모두에서 잘 보이도록 노란색 + 검은 외곽선)
export const PREVIEW_INTERVAL_MS = 1000; // 영역 확대 미리보기 갱신 주기
export const PREVIEW_MAX_W = 800;      // 영역 확대 미리보기 최대 크기 (캔버스 내부 해상도)
export const PREVIEW_MAX_H = 300;

// ===== 숫자 인식 방식 =====
export const RECOGNITION_MODES = ['ocr', 'sevenSegment']; // OCR(Tesseract.js) | 기존 7세그먼트 판독
export const DEFAULT_RECOGNITION_MODE = 'ocr';
export const TEMP_MIN = 0;             // 정상 온도 범위 (벗어나면 판독 실패)
export const TEMP_MAX = 1400;
export const JUMP_WARN_DEG = 80;       // 직전 판독값보다 이만큼 넘게 바뀌면 "확인 필요" 표시 (온도는 그대로 둠)
export const JUMP_COMPARE_MS = 120000; // 이보다 오래된 직전 판독값과는 비교하지 않음
export const FRAME_SETTLE_MS = 800;    // 카메라 시작·회전 후 영상 크기가 이 시간 동안 그대로여야 판독 시작

// ===== OCR (Tesseract.js, 버전 고정. index.html의 script 태그 버전과 같아야 함) =====
export const TESSERACT_VERSION = '7.0.0';
export const TESSERACT_WORKER_PATH = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js';
export const TESSERACT_CORE_PATH = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0';  // 기기에 맞는 wasm(SIMD 등)을 자동 선택
// 7세그먼트 글꼴로 학습한 Tesseract 숫자 모델 (ssd_int, 약 1.4MB, Apache-2.0). 커밋 고정.
// 일반 영어 모델(eng)은 떨어진 세그먼트를 숫자로 잘 읽지 못함 (합성 7세그먼트 시험에서 대부분 실패)
export const TESSERACT_LANG_PATH = 'https://cdn.jsdelivr.net/gh/Shreeshrii/tessdata_ssd@e493a10a4bf81632506cf24ba99d83854afff9f6';
export const OCR_LANG = 'ssd_int';
export const OCR_LANG_GZIP = false;      // 위 저장소의 파일은 .traineddata (gzip 아님)
export const OCR_WHITELIST = '0123456789';
export const OCR_PSM_SINGLE_LINE = '7';  // Tesseract 페이지 분할 모드: 한 줄
export const OCR_MIN_CONFIDENCE = 0.4;   // 이보다 낮으면 숫자를 읽었어도 판독 실패로 처리
export const OCR_INIT_TIMEOUT_MS = 90000;      // 엔진 준비(파일 내려받기 포함) 제한 시간
export const OCR_RECOGNIZE_TIMEOUT_MS = 20000; // 한 번 인식 제한 시간 (넘으면 엔진을 다시 준비)
// OCR 입력 이미지 전처리
export const OCR_PREPROCESS_OPTIONS = ['auto', 'red', 'gray', 'contrast']; // 자동 | 빨간 LED 강조 이진화 | 흑백 이진화 | 대비 조정 원본
export const DEFAULT_OCR_PREPROCESS = 'auto';
// OCR 입력 숫자 높이. 작은 ROI는 확대, 큰 ROI는 축소해 이 높이로 맞춤
// (합성 7세그먼트 시험에서 48~64px가 가장 잘 읽혔고, 3배 확대한 192px는 오히려 나빴음)
export const OCR_TARGET_H = 64;
export const OCR_PAD_RATIO = 0.25;     // 상하좌우 흰 여백 (OCR 입력 높이 대비)
export const OCR_CLOSE_RATIO = 0.02;   // 세그먼트 사이 틈 메우기 반경 (OCR 입력 높이 대비)
export const OCR_THICKEN_RATIO = 1 / 64; // 이진화 후 획 굵히기 반경 (64px에서 1px)
export const OCR_SATURATED_R = 240;    // 빨간 LED 중심이 하얗게 포화된 픽셀 판정 (R, G, B 모두 높음)
export const OCR_SATURATED_GB = 180;

// ===== 7세그먼트 판독 =====
export const READ_MAX_W = 480;         // 판독할 때 ROI를 이 너비 이하로 줄여서 처리 (속도)
export const LIVE_READ_MS = 1000;      // 판독 확인 주기 (7세그먼트는 매번 판독, OCR은 판독 주기마다)
export const CONF_HIGH = 0.7;          // 신뢰도 표시 색 기준 (이상이면 높음)
export const CONF_LOW = 0.4;           // (미만이면 낮음)
// 7세그먼트 샘플 영역 (자릿수 셀 대비 비율). 순서는 a~g 고정 (패턴 문자열 생성 순서)
export const SEGMENTS = [
  { id: 'a', x0: 0.20, x1: 0.80, y0: 0.04, y1: 0.16 }, // 위
  { id: 'b', x0: 0.76, x1: 0.96, y0: 0.16, y1: 0.46 }, // 오른쪽 위
  { id: 'c', x0: 0.76, x1: 0.96, y0: 0.54, y1: 0.84 }, // 오른쪽 아래
  { id: 'd', x0: 0.20, x1: 0.80, y0: 0.84, y1: 0.96 }, // 아래
  { id: 'e', x0: 0.04, x1: 0.24, y0: 0.54, y1: 0.84 }, // 왼쪽 아래
  { id: 'f', x0: 0.04, x1: 0.24, y0: 0.16, y1: 0.46 }, // 왼쪽 위
  { id: 'g', x0: 0.20, x1: 0.80, y0: 0.44, y1: 0.56 }  // 가운데
];

// 숫자별 켜지는 세그먼트 (a~g 순서로 표기)
export const DIGIT_PATTERNS = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abdeg',
  '3': 'abcdg',
  '4': 'bcfg',
  '5': 'acdfg',
  '6': 'acdefg',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abcdfg'
};

// 세그먼트 패턴 → 숫자 역방향 표
export const PATTERN_TO_DIGIT = Object.keys(DIGIT_PATTERNS).reduce((map, d) => {
  map[DIGIT_PATTERNS[d]] = d;
  return map;
}, {});
