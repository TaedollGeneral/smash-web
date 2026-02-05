/**
 * [FILE: routes/api.js]
 * 역할: 프론트엔드와 서버의 API 엔드포인트
 */

const express = require('express');
const router = express.Router();
const db = require('../config/db');
const TimeManager = require('../utils/TimeManager');

// 요청 간격 제한용 (학번별 마지막 요청 시간)
const lastRequestTime = {};
const MIN_REQUEST_INTERVAL = 1000; // 1초

function checkRequestInterval(id) {
    const now = Date.now();
    if (lastRequestTime[id] && (now - lastRequestTime[id]) < MIN_REQUEST_INTERVAL) {
        return false;
    }
    lastRequestTime[id] = now;
    return true;
}

// ============================================================
// [SECTION 1] 일반 사용자 기능 (신청/취소/조회)
// ============================================================

// 1. 신청하기
router.post('/apply', async (req, res) => {
    const { id, pwd, category, name, day } = req.body;

     // 요청 간격 체크 (마스터키 제외)
    const isMaster = TimeManager.checkMasterKey(pwd);
    if (!isMaster && !checkRequestInterval(id)) {
        return res.json({ success: false, message: '너무 빠른 요청입니다. 1초 후 다시 시도하세요.' });
    }
    let applicantName = "관리자(대리)";

    if (!isMaster) {
        // 시간 검증
        const timeCheck = TimeManager.validateApplyTime(day, category);
        if (!timeCheck.valid) {
            return res.json({ success: false, message: timeCheck.msg });
        }

        // 본인 확인
        try {
            const user = await checkUserAuth(id, pwd);
            if (!user.valid) return res.json({ success: false, message: user.msg });
            applicantName = user.name;
        } catch (e) {
            return res.json({ success: false, message: "DB 에러" });
        }
    }

    // 중복 검사 및 저장
    const dupSql = `SELECT * FROM applications WHERE student_id = ? AND day = ? AND category = ?`;
    db.query(dupSql, [id, day, category], (err, rows) => {
        if (rows && rows.length > 0) {
            return res.json({ success: false, message: "이미 신청 내역이 있습니다." });
        }

        const insertSql = `INSERT INTO applications (student_id, day, category, guest_name) VALUES (?, ?, ?, ?)`;
        db.query(insertSql, [id, day, category, name], (err) => {
            if (err) return res.status(500).json({ success: false, message: '저장 에러' });
            res.json({ success: true, message: '신청 완료!', userName: applicantName });
        });
    });
});

// 2. 취소하기
router.post('/cancel', async (req, res) => {
    const { id, pwd, category, day } = req.body;
    // 요청 간격 체크 (마스터키 제외)
    const isMaster = TimeManager.checkMasterKey(pwd);
    if (!isMaster && !checkRequestInterval(id)) {
        return res.json({ success: false, message: '너무 빠른 요청입니다. 1초 후 다시 시도하세요.' });
    }
    
    if (!isMaster) {
        // 시간 검증
        const timeCheck = TimeManager.validateCancelTime(day, category);
        if (!timeCheck.valid) {
            return res.json({ success: false, message: timeCheck.msg });
        }

        // 본인 확인
        try {
            const user = await checkUserAuth(id, pwd);
            if (!user.valid) return res.json({ success: false, message: user.msg });
        } catch (e) {
            return res.json({ success: false, message: "DB 에러" });
        }
    }

    // 삭제
    const deleteSql = `DELETE FROM applications WHERE student_id = ? AND category = ? AND day = ?`;
    db.query(deleteSql, [id, category, day], (err, result) => {
        if (err) return res.status(500).json({ success: false, message: 'DB 에러' });
        if (result.affectedRows === 0) return res.json({ success: false, message: '신청 내역이 없습니다.' });
        res.json({ success: true, message: '취소 완료' });
    });
});

// 3. 현황 조회
router.get('/status', (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    const day = req.query.day || 'WED';
    const sql = `
        SELECT a.category, u.name as user_name, a.guest_name, a.student_id, a.created_at, a.id 
        FROM applications a
        JOIN users u ON a.student_id = u.student_id
        WHERE a.day = ? 
        ORDER BY a.created_at ASC, a.id ASC
    `;
    db.query(sql, [day], (err, results) => {
        if (err) res.status(500).send('DB Error');
        else res.json(results);
    });
});

// ============================================================
// [SECTION 2] 프론트엔드 UI 지원 API
// ============================================================

// 4. 타이머 정보
router.get('/timer', (req, res) => {
    const status = TimeManager.getAllTimerStatus();
    res.json(status);
});

// 5. 명단 제목 텍스트
router.get('/title-text', (req, res) => {
    const day = req.query.day || 'WED';
    const text = TimeManager.getTitleText(day);
    res.json({ text });
});

// 6. 시스템 정보
router.get('/info', (req, res) => {
    const info = TimeManager.getSystemInfo();
    res.json(info);
});

// ============================================================
// [SECTION 3] 관리자 전용 API
// ============================================================

// 7. 관리자 인증
router.post('/admin/verify', (req, res) => {
    const { masterKey } = req.body;
    if (TimeManager.checkMasterKey(masterKey)) {
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, message: "비밀번호 불일치" });
    }
});

// 8. 학기/주차 설정
router.post('/admin/semester', (req, res) => {
    const { masterKey, semester, week } = req.body;

    if (!TimeManager.checkMasterKey(masterKey)) {
        return res.json({ success: false, message: "관리자 권한이 없습니다." });
    }

    if (!semester || !week) {
        return res.json({ success: false, message: "정보가 부족합니다." });
    }

    TimeManager.setSemester(semester, parseInt(week));
    res.json({ success: true, message: `${semester}학기 ${week}주차로 설정되었습니다.` });
});

// 9. 시간 오버라이드 설정
router.post('/admin/override', (req, res) => {
    const { masterKey, key, seconds } = req.body;

    if (!TimeManager.checkMasterKey(masterKey)) {
        return res.json({ success: false, message: "권한 없음" });
    }

    if (!key || seconds === undefined) {
        return res.json({ success: false, message: "정보가 부족합니다." });
    }

    TimeManager.setOverride(key, parseInt(seconds));
    res.json({ success: true, message: `${key} = ${seconds}초로 설정되었습니다.` });
});

// 10. 모든 오버라이드 초기화
router.post('/admin/override/reset', (req, res) => {
    const { masterKey } = req.body;

    if (!TimeManager.checkMasterKey(masterKey)) {
        return res.json({ success: false, message: "권한 없음" });
    }

    TimeManager.resetOverrides();
    res.json({ success: true });
});

// ============================================================
// [Helper] 본인 확인 함수
// ============================================================
function checkUserAuth(id, pwd) {
    return new Promise((resolve, reject) => {
        const sql = `SELECT name FROM users WHERE student_id = ? AND password = ?`;
        db.query(sql, [id, pwd], (err, users) => {
            if (err) return reject(err);
            if (users.length === 0) return resolve({ valid: false, msg: "학번 또는 비밀번호 오류" });
            resolve({ valid: true, name: users[0].name });
        });
    });
}

module.exports = router;