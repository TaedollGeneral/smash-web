/**
 * [FILE: utils/TimeManager.js]
 * 역할: 프로그램의 시간 세계 관리
 * 
 * 핵심 개념:
 * - 매주 토요일 00:00:00에 새로운 "주차"가 시작됨
 * - 모든 시간은 "지난 토요일 00:00:00 기준 몇 초 후"로 표현
 * - 1주일 = 604,800초
 */

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'config.json');
const MASTER_KEY = "2026m";
const WEEK_SECONDS = 604800; // 7일 * 24시간 * 60분 * 60초

class TimeManager {
    constructor() {
        this.config = this.loadConfig();
    }

    // ============================================================
    // [SECTION 1] Config 관리
    // ============================================================

    loadConfig() {
        try {
            return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        } catch (err) {
            console.error('❌ config.json 로드 실패, 기본값 사용');
            return this.getDefaultConfig();
        }
    }

    saveConfig() {
        try {
            fs.writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2));
        } catch (err) {
            console.error('❌ config.json 저장 실패:', err);
        }
    }

    getDefaultConfig() {
        return {
            system: { semester: "1", week: 1 },
            rules: {
                WED_EXERCISE_OPEN: 79200,
                WED_EXERCISE_CLOSE: 165600,
                WED_EXERCISE_CANCEL: 345600,
                WED_GUEST_OPEN: 79200,
                WED_GUEST_CLOSE: 410400,
                WED_GUEST_CANCEL: 432000,
                WED_LESSON_OPEN: 79200,
                WED_LESSON_CLOSE: 165600,
                WED_LESSON_CANCEL: 345600,
                FRI_EXERCISE_OPEN: 79200,
                FRI_EXERCISE_CLOSE: 165600,
                FRI_EXERCISE_CANCEL: 518400,
                FRI_GUEST_OPEN: 79200,
                FRI_GUEST_CLOSE: 579600,
                FRI_GUEST_CANCEL: 604800
            },
            overrides: {}
        };
    }

    // ============================================================
    // [SECTION 2] 핵심 시간 계산
    // ============================================================

    /**
     * 지난 토요일 00:00:00을 구함 (프로그램 세계의 시작점)
     * - 토요일이면 오늘 00:00:00
     * - 일~금이면 지난 토요일 00:00:00
     */
    getLastSaturday() {
        const now = new Date();
        const day = now.getDay(); // 0=일, 1=월, ..., 5=금, 6=토

        const daysBack = (day === 6) ? 0 : (day + 1);
        // 토=0, 일=1, 월=2, 화=3, 수=4, 목=5, 금=6

        const saturday = new Date(now);
        saturday.setDate(now.getDate() - daysBack);
        saturday.setHours(0, 0, 0, 0);

        return saturday;
    }

    /**
     * 현재 시간이 "이번 주 토요일 00:00:00" 기준 몇 초 후인지
     */
    getElapsedSeconds() {
        const now = new Date();
        const saturday = this.getLastSaturday();
        return Math.floor((now - saturday) / 1000);
    }

    /**
     * 특정 규칙의 시간값 가져오기 (오버라이드 우선)
     */
    getRuleValue(key) {
        if (this.config.overrides && this.config.overrides[key] !== undefined && this.config.overrides[key] !== null) {
            return this.config.overrides[key];
        }
        return this.config.rules[key];
    }

    // ============================================================
    // [SECTION 3] 상태 계산 (프론트엔드 타이머용)
    // ============================================================

    /**
     * 특정 카테고리의 현재 상태와 다음 목표 시간 계산
     */
    getCategoryState(categoryId) {
        // categoryId: WED_EXERCISE, WED_GUEST, WED_LESSON, FRI_EXERCISE, FRI_GUEST
        const openTime = this.getRuleValue(`${categoryId}_OPEN`);
        const closeTime = this.getRuleValue(`${categoryId}_CLOSE`);
        const cancelTime = this.getRuleValue(`${categoryId}_CANCEL`);

        const elapsed = this.getElapsedSeconds();
        const saturday = this.getLastSaturday();

        if (elapsed < openTime) {
            // 오픈 전
            return {
                state: 'OPEN_WAIT',
                targetSeconds: openTime,
                targetDate: new Date(saturday.getTime() + openTime * 1000)
            };
        } else if (elapsed < closeTime) {
            // 신청 가능
            return {
                state: 'CLOSING',
                targetSeconds: closeTime,
                targetDate: new Date(saturday.getTime() + closeTime * 1000)
            };
        } else if (elapsed < cancelTime) {
            // 신청 마감, 취소만 가능
            return {
                state: 'CANCEL_CLOSING',
                targetSeconds: cancelTime,
                targetDate: new Date(saturday.getTime() + cancelTime * 1000)
            };
        } else {
            // 이번 주 완전 마감 → 다음 주 오픈 대기
            return {
                state: 'OPEN_WAIT',
                targetSeconds: openTime + WEEK_SECONDS,
                targetDate: new Date(saturday.getTime() + (openTime + WEEK_SECONDS) * 1000)
            };
        }
    }

    /**
     * 모든 카테고리 상태 반환 (프론트엔드 /api/timer용)
     */
    getAllTimerStatus() {
        const categories = ['WED_EXERCISE', 'WED_GUEST', 'WED_LESSON', 'FRI_EXERCISE', 'FRI_GUEST'];
        const result = {};

        categories.forEach(catId => {
            const state = this.getCategoryState(catId);
            result[catId] = {
                state: state.state,
                target: state.targetDate.toISOString()
            };
        });

        return result;
    }

    // ============================================================
    // [SECTION 4] 신청/취소 검증
    // ============================================================

    /**
     * 신청 가능한지 검증
     */
    validateApplyTime(day, category) {
        if (day === 'FRI' && category === 'lesson') {
            return { valid: false, msg: "금요일에는 레슨이 없습니다." };
        }

        const categoryId = `${day}_${category.toUpperCase()}`;
        const state = this.getCategoryState(categoryId);

        if (state.state === 'OPEN_WAIT') {
            return { valid: false, msg: "아직 신청 기간이 아닙니다." };
        }
        if (state.state === 'CANCEL_CLOSING') {
            return { valid: false, msg: "신청이 마감되었습니다." };
        }

        return { valid: true };
    }

    /**
     * 취소 가능한지 검증
     */
    validateCancelTime(day, category) {
        const categoryId = `${day}_${category.toUpperCase()}`;
        const cancelTime = this.getRuleValue(`${categoryId}_CANCEL`);
        const elapsed = this.getElapsedSeconds();

        if (elapsed >= cancelTime) {
            return { valid: false, msg: "취소 가능 시간이 지났습니다." };
        }

        // 오픈 전에도 취소 불가 (신청 자체가 없으니)
        const openTime = this.getRuleValue(`${categoryId}_OPEN`);
        if (elapsed < openTime) {
            return { valid: false, msg: "아직 신청 기간이 아닙니다." };
        }

        return { valid: true };
    }

    // ============================================================
    // [SECTION 5] 날짜 계산 (명단 복사용)
    // ============================================================

    /**
     * 이번 주 수요일 날짜
     */
    getWednesdayDate() {
        const saturday = this.getLastSaturday();
        const wednesday = new Date(saturday);
        wednesday.setDate(saturday.getDate() + 4); // 토+4 = 수
        return wednesday;
    }

    /**
     * 이번 주 금요일 날짜
     */
    getFridayDate() {
        const saturday = this.getLastSaturday();
        const friday = new Date(saturday);
        friday.setDate(saturday.getDate() + 6); // 토+6 = 금
        return friday;
    }

    /**
     * 명단 복사용 제목 텍스트
     */
    getTitleText(day) {
        const targetDate = (day === 'WED') ? this.getWednesdayDate() : this.getFridayDate();
        const month = targetDate.getMonth() + 1;
        const date = targetDate.getDate();
        const dayName = (day === 'WED') ? '수요일' : '금요일';
        const type = (day === 'WED') ? '정기운동 18-21시' : '추가운동 15-17시';
        return `${month}/${date} ${dayName} ${type}`;
    }

    // ============================================================
    // [SECTION 6] 시스템 정보
    // ============================================================

    getSystemInfo() {
        return this.config.system;
    }

    /**
     * 학기/주차 설정 (관리자용)
     */
    setSemester(semester, week) {
        this.config.system.semester = semester;
        this.config.system.week = parseInt(week) || 1;
        this.config.overrides = {}; // 오버라이드 리셋
        this.saveConfig();
        console.log(`🔄 [TimeManager] ${semester}학기 ${week}주차로 설정됨`);
    }

    /**
     * 주차 증가 (스케줄러용)
     */
    incrementWeek() {
        this.config.system.week += 1;
        this.config.overrides = {}; // 오버라이드 리셋
        this.saveConfig();
        console.log(`🔄 [TimeManager] ${this.config.system.week}주차로 증가`);
    }

    // ============================================================
    // [SECTION 7] 오버라이드 관리
    // ============================================================

    /**
     * 특정 규칙 오버라이드 설정
     * @param key - 예: WED_EXERCISE_OPEN
     * @param seconds - 토요일 00:00 기준 초
     */
    setOverride(key, seconds) {
        if (!this.config.overrides) {
            this.config.overrides = {};
        }
        this.config.overrides[key] = seconds;
        this.saveConfig();
        console.log(`⚡ [TimeManager] Override: ${key} = ${seconds}초`);
    }

    /**
     * 모든 오버라이드 초기화
     */
    resetOverrides() {
        this.config.overrides = {};
        this.saveConfig();
        console.log(`🔄 [TimeManager] 모든 오버라이드 초기화`);
    }

    // ============================================================
    // [SECTION 8] 마스터키
    // ============================================================

    checkMasterKey(inputKey) {
        return inputKey === MASTER_KEY;
    }
}

module.exports = new TimeManager();