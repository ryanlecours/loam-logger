import type { GraphQLContext } from '../server.ts';
import { prisma } from '../lib/prisma.ts';

type UserArgs = { id: string };

export const resolvers = {
  Query: {
    user: (args: UserArgs) =>
      prisma.user.findUnique({
        where: { id: args.id },
        include: { rides: true },
      }),

    rides: () =>
      prisma.ride.findMany(),

    me: async (ctx: GraphQLContext) => {
      const id = ctx.user?.id;
      return id ? prisma.user.findUnique({ where: { id } }) : null;
    },
  },
  // TODO: unit formatting logic could go here later
};
