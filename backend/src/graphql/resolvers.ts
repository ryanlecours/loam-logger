import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const resolvers = {
  Query: {
    user: (args: { id: string }) =>
      prisma.user.findUnique({
        where: { id: args.id },
        include: { rides: true },
      }),
    rides: () => prisma.ride.findMany(),
    me: async (_: unknown, __: unknown, { req }: any) => {
      const id = req.user?.id;
      return id ? prisma.user.findUnique({ where: { id } }) : null;
    },
  },
  //TODO: unit formatting logic could go here later
};
