ALTER TABLE "generations" ALTER COLUMN "userId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "generations" ALTER COLUMN "prompt" SET DATA TYPE varchar(2000);