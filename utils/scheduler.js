/**
 * [FILE: utils/scheduler.js]
 * 역할: 매주 토요일 00:00:01에 새로운 주차 시작
 *       - DB 백업 및 초기화
 *       - 주차 증가
 *       - 오버라이드 리셋 (TimeManager.incrementWeek에서 처리)
 */

const schedule = require('node-schedule');
const fs = require('fs');
const path = require('path');
const db = require('../config/db');
const TimeManager = require('./TimeManager');

const dataDir = path.join(__dirname, '..', 'data');

function startScheduler() {
    // 매주 토요일 00시 00분 01초 실행
    schedule.scheduleJob('1 0 0 * * 6', function() {
        console.log('⏰ [스케줄러] 새로운 주차 시작...');

        // 1. 현재 주차 정보 가져오기 (백업 파일명용)
        const sysInfo = TimeManager.getSystemInfo();
        const year = new Date().getFullYear();
        const backupFileName = `${year}_${sysInfo.semester}학기_${sysInfo.week}주차_backup.json`;
        const backupPath = path.join(dataDir, backupFileName);

        // 2. DB 백업
        const selectSql = `SELECT * FROM applications`;
        db.query(selectSql, (err, rows) => {
            if (err) {
                console.error('❌ 백업 중 DB 조회 실패:', err);
                return;
            }

            try {
                fs.writeFileSync(backupPath, JSON.stringify(rows, null, 2));
                console.log(`📂 [백업 완료] ${backupFileName}`);
            } catch (fileErr) {
                console.error('❌ 백업 파일 저장 실패:', fileErr);
            }

            // 3. DB 초기화
            const deleteSql = `TRUNCATE TABLE applications`;
            db.query(deleteSql, (delErr) => {
                if (delErr) {
                    console.error('❌ 데이터 삭제 실패:', delErr);
                } else {
                    console.log('✨ [청소 완료] applications 테이블 초기화됨');

                    // 4. 주차 증가 (오버라이드도 리셋됨)
                    TimeManager.incrementWeek();
                }
            });
        });
    });

    console.log('📅 [시스템] 주간 자동 초기화 스케줄러 가동 (토요일 00:00)');
}

module.exports = { startScheduler };