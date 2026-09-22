-- AlterTable
ALTER TABLE "User" ADD COLUMN     "accessCode" TEXT,
ADD COLUMN     "accessCodeExpiry" TIMESTAMP(3),
ADD COLUMN     "approvalStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedBy" TEXT,
ADD COLUMN     "rejectedReason" TEXT,
ADD COLUMN     "signupIp" TEXT,
ADD COLUMN     "signupLocation" TEXT,
ADD COLUMN     "signupUserAgent" TEXT;

-- CreateTable
CREATE TABLE "ExternalBeneficiary" (
    "id" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "routingNumber" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountType" TEXT NOT NULL DEFAULT 'checking',
    "customerId" TEXT,
    "description" TEXT,
    "isVerified" BOOLEAN NOT NULL DEFAULT true,
    "addedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalBeneficiary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExternalBeneficiary_accountNumber_key" ON "ExternalBeneficiary"("accountNumber");
