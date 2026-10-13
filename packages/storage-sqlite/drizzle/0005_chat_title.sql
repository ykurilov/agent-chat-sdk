ALTER TABLE `chats` ADD `title` text;--> statement-breakpoint
-- Названия у прежних чатов: из первого текста первого сообщения собеседника, как это делает ядро
-- (пробелы схлопнуты, не длиннее 60 знаков и «…»). Очень длинные ряды пробелов (больше 64) схлопываются не до конца.
UPDATE `chats` SET `title` = (
  SELECT CASE
    WHEN length(t) = 0 THEN NULL
    WHEN length(t) > 60 THEN rtrim(substr(t, 1, 60)) || '…'
    ELSE t
  END
  FROM (
    SELECT trim(replace(replace(replace(replace(replace(replace(replace(replace(replace(x, char(13), ' '), char(10), ' '), char(9), ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' ')) AS t
    FROM (
      SELECT (
        SELECT json_extract(p.value, '$.text') FROM json_each(m.parts) AS p
        WHERE json_extract(p.value, '$.type') = 'text' LIMIT 1
      ) AS x
      FROM `messages` AS m
      WHERE m.chat_id = `chats`.id AND m.role = 'user'
      ORDER BY m.created_at, m.seq LIMIT 1
    )
  )
);
