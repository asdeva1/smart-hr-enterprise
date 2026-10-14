-- CreateTable
CREATE TABLE "installation" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "installation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installation_licence" (
    "id" UUID NOT NULL,
    "licence_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "plan_code" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "installed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "installed_by_user_id" UUID,
    "replaced_at" TIMESTAMPTZ(6),

    CONSTRAINT "installation_licence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "installation_licence_licence_id_key" ON "installation_licence"("licence_id");

-- CreateIndex
CREATE INDEX "installation_licence_replaced_at_idx" ON "installation_licence"("replaced_at");

-- AddForeignKey
ALTER TABLE "installation_licence" ADD CONSTRAINT "installation_licence_installed_by_user_id_fkey" FOREIGN KEY ("installed_by_user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
