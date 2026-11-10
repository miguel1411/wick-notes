-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "contentSearch" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "contentText" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "titleSearch" TEXT NOT NULL DEFAULT '';
