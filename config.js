// Supabase 연결 정보 (anon/publishable 키는 공개용 키입니다. 데이터는 RLS 정책으로 본인만 접근 가능)
// 비워두면 브라우저 localStorage에 저장하는 로컬 모드로 동작합니다.
export const SUPABASE_URL = 'https://gcnfvcbatpohhctitnkl.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_8zyr4Cia8y1JiVOguUC12Q_ZOknEH3F';

// 처음 실행할 때 자동으로 들어가는 기본 목표 대회 (설정 탭에서 언제든 변경 가능)
export const DEFAULT_RACE = { race_name: 'JTBC 서울마라톤', race_date: '2026-11-01', goal_time: '3:30:00' };
