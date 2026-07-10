/*
  Warnings:

  - Added the required column `userId` to the `Chat` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "public"."PdfStatus" AS ENUM ('PROCESSING', 'READY', 'FAILED');

-- DropForeignKey
ALTER TABLE "public"."Chat" DROP CONSTRAINT "Chat_pdfId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Pdf" DROP CONSTRAINT "Pdf_userId_fkey";

-- DropIndex
DROP INDEX "public"."Pdf_fileUrl_key";

-- AlterTable
ALTER TABLE "public"."Chat" ADD COLUMN     "sources" JSONB,
ADD COLUMN     "userId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "public"."Pdf" ADD COLUMN     "status" "public"."PdfStatus" NOT NULL DEFAULT 'PROCESSING',
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "public"."User" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AddForeignKey
ALTER TABLE "public"."Pdf" ADD CONSTRAINT "Pdf_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Chat" ADD CONSTRAINT "Chat_pdfId_fkey" FOREIGN KEY ("pdfId") REFERENCES "public"."Pdf"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Chat" ADD CONSTRAINT "Chat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
