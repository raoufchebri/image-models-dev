CREATE TABLE "generations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "generations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"userId" varchar(255) NOT NULL,
	"prompt" varchar(255) NOT NULL,
	"inputImageUrl" varchar(255) NOT NULL,
	"outputImageUrl" varchar(255) NOT NULL,
	"model" varchar(255) NOT NULL,
	"status" varchar(255) NOT NULL,
	"error" varchar(255) NOT NULL,
	"metadata" jsonb NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
