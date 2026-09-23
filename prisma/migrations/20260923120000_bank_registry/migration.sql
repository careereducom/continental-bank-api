-- CreateTable
CREATE TABLE "BankRegistry" (
    "id" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "routingNumber" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountType" TEXT NOT NULL DEFAULT 'checking',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankRegistry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BankRegistry_accountNumber_key" ON "BankRegistry"("accountNumber");
CREATE INDEX "BankRegistry_accountNumber_idx" ON "BankRegistry"("accountNumber");
CREATE INDEX "BankRegistry_routingNumber_idx" ON "BankRegistry"("routingNumber");