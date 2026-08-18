SELECT notice_type, COUNT(*) AS cnt FROM easy_prt GROUP BY notice_type;
SELECT id, LEFT(title, 60) AS title, notice_type, notice_time
FROM easy_prt
WHERE notice_type = '中标公告'
ORDER BY notice_time DESC
LIMIT 10;
