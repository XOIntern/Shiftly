DELETE FROM roster_rule_config WHERE rule_key = 'C7';--> statement-breakpoint
CREATE TYPE roster_rule_key_new AS ENUM ('C1','C2','C3','C4','C5','C6','C7');--> statement-breakpoint
ALTER TABLE roster_rule_config
  ALTER COLUMN rule_key TYPE roster_rule_key_new
  USING (CASE WHEN rule_key::text = 'C8' THEN 'C7' ELSE rule_key::text END)::roster_rule_key_new;--> statement-breakpoint
DROP TYPE roster_rule_key;--> statement-breakpoint
ALTER TYPE roster_rule_key_new RENAME TO roster_rule_key;