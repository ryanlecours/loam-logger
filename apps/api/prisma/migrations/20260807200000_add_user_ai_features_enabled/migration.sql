-- AI output (the advisor maintenance summary) becomes strictly opt-in.
-- Off by default for every existing and future user, all tiers included;
-- the advisorSummary resolver checks this alongside the Pro gate.
ALTER TABLE "User" ADD COLUMN "aiFeaturesEnabled" BOOLEAN NOT NULL DEFAULT false;
