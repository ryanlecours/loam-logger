/*
  Warnings:

  - You are about to drop the column `revenuecatAppUserId` on the `User` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "User_revenuecatAppUserId_key";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "revenuecatAppUserId";
