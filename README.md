# 특허 블록도 에디터 (Patent Block Diagram)

특허 도면용 블록도를 그리는 데스크톱 앱 (macOS / Windows).

## 특징

- **도형**: 사각형 · 둥근 사각형 · 마름모 · 원기둥(DB) — 모두 우하단 검은색 오프셋 음영 (번짐 없는 특허 도면 스타일)
- **화살표**: 직선 / 직각 꺾임, 화살표 선택 후 전환 가능
- **도면부호 태그**: 물결(~) 지시선 + 숫자 (100, 110, … 자동 증가), 드래그로 위치 조절
- **텍스트**: 시스템 고딕 폰트 (macOS: Apple SD Gothic Neo, Windows: 맑은 고딕), 줄바꿈 지원
- **내보내기**: 고해상도(3×) PNG, 흰 배경
- **저장**: 자체 JSON 형식 저장/열기, ⌘/Ctrl+Z 실행 취소

## 설치 (Windows)

[Releases](../../releases)에서 `PatentBlockDiagram-Setup-*.exe`를 받아 실행.
(코드 서명이 없어 SmartScreen 경고가 뜨면 "추가 정보 → 실행"을 누르면 됩니다.)

## 개발 실행

```bash
npm install
npm start
```

## 빌드

```bash
npm run dist:win   # Windows NSIS 설치본
npm run dist:mac   # macOS DMG
```

## 사용법

| 동작 | 방법 |
|---|---|
| 도형 생성 | 툴바 버튼 또는 빈 곳 더블클릭(사각형) |
| 텍스트 편집 | 도형 선택 후 툴바 입력창, 또는 도형 더블클릭 |
| 화살표 | `화살표 연결` → 시작 도형 → 끝 도형 클릭 |
| 부호 태그 | 도형 선택 → `부호 태그`, 숫자 더블클릭으로 수정 |
| 복사/붙여넣기 | 요소 선택 → ⌘(Ctrl)+C, ⌘(Ctrl)+V |
| 삭제 / 실행취소 | Delete / ⌘(Ctrl)+Z |
