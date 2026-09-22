-- CreateTable
CREATE TABLE "Worker" (
    "id" TEXT NOT NULL,
    "payrollUserId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'STAFF',
    "department" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "photoUrl" TEXT,
    "accountNumber" TEXT,
    "monthlySalary" DECIMAL(15,2),
    "hireDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Worker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollPayment" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "payrollUserId" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "fromAccountId" TEXT NOT NULL,
    "transactionId" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidBy" TEXT NOT NULL,

    CONSTRAINT "PayrollPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayrollPayment_reference_key" ON "PayrollPayment"("reference");

-- AddForeignKey
ALTER TABLE "Worker" ADD CONSTRAINT "Worker_payrollUserId_fkey" FOREIGN KEY ("payrollUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPayment" ADD CONSTRAINT "PayrollPayment_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPayment" ADD CONSTRAINT "PayrollPayment_payrollUserId_fkey" FOREIGN KEY ("payrollUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
