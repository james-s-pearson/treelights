-- SQL sample for Treelights tests.
SELECT u.id, u.name, COUNT(f.id) AS findings
FROM users AS u
LEFT JOIN findings f ON f.user_id = u.id
WHERE u.active = TRUE AND f.severity >= 7
GROUP BY u.id, u.name
HAVING COUNT(f.id) > 0
ORDER BY findings DESC
LIMIT 10;

INSERT INTO findings (title, severity) VALUES ('Open port', 8);
UPDATE users SET active = FALSE WHERE last_login < '2026-01-01';
