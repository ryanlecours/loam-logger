import { PrismaClient } from '../generated/prisma/index.js';

const prisma = new PrismaClient();

export const resolvers = {
  Query: {
    users: () => prisma.user.findMany({ include: { rides: true } }),
    user: (_: any, args: { id: string }) =>
      prisma.user.findUnique({
        where: { id: args.id },
        include: { rides: true },
      }),
    rides: () => prisma.ride.findMany(),
  },
  //TODO: unit formatting logic could go here later
};
