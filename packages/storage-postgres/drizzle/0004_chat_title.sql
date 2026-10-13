ALTER TABLE "agent_chat"."chats" ADD COLUMN "title" text;--> statement-breakpoint
-- Названия у прежних чатов: из первого текста первого сообщения собеседника, как это делает ядро
-- (пробелы схлопнуты, не длиннее 60 знаков и «…»).
UPDATE "agent_chat"."chats" AS c SET "title" = (
  SELECT CASE
    WHEN char_length(t) = 0 THEN NULL
    WHEN char_length(t) > 60 THEN rtrim(left(t, 60)) || '…'
    ELSE t
  END
  FROM (
    SELECT btrim(regexp_replace(x, '\s+', ' ', 'g')) AS t
    FROM (
      SELECT (
        SELECT p->>'text' FROM json_array_elements(m.parts) AS p
        WHERE p->>'type' = 'text' LIMIT 1
      ) AS x
      FROM "agent_chat"."messages" AS m
      WHERE m.chat_id = c.id AND m.role = 'user'
      ORDER BY m.created_at, m.seq LIMIT 1
    ) AS first_text
  ) AS cleaned
);
