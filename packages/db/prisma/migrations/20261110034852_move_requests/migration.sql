-- CreateEnum
CREATE TYPE "MoveRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'FAILED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "MoveRequest" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "tokenId" TEXT,
    "targetWorkspaceId" TEXT NOT NULL,
    "targetFolderId" TEXT,
    "reason" TEXT,
    "status" "MoveRequestStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MoveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MoveRequest_requestedById_status_idx" ON "MoveRequest"("requestedById", "status");

-- CreateIndex
CREATE INDEX "MoveRequest_documentId_status_idx" ON "MoveRequest"("documentId", "status");

-- AddForeignKey
ALTER TABLE "MoveRequest" ADD CONSTRAINT "MoveRequest_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoveRequest" ADD CONSTRAINT "MoveRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoveRequest" ADD CONSTRAINT "MoveRequest_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "ApiToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoveRequest" ADD CONSTRAINT "MoveRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
