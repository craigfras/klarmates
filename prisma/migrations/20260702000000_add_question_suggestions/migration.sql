-- CreateTable
CREATE TABLE "question_suggestions" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "suggested_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "question_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "question_suggestions_suggested_by_id_idx" ON "question_suggestions"("suggested_by_id");

-- AddForeignKey
ALTER TABLE "question_suggestions" ADD CONSTRAINT "question_suggestions_suggested_by_id_fkey" FOREIGN KEY ("suggested_by_id") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
