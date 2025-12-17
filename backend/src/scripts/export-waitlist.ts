import { prisma } from '../lib/prisma';
import * as fs from 'fs';
import * as path from 'path';

async function exportWaitlist() {
  try {
    const entries = await prisma.betaWaitlist.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        email: true,
        name: true,
        createdAt: true,
        referrer: true,
      },
    });

    // Create waitlist directory if it doesn't exist
    const waitlistDir = path.join(process.cwd(), 'waitlist');
    if (!fs.existsSync(waitlistDir)) {
      fs.mkdirSync(waitlistDir, { recursive: true });
    }

    // CSV format
    const csv = [
      'Email,Name,Signed Up,Referrer',
      ...entries.map(e =>
        `"${e.email}","${e.name || ''}","${e.createdAt.toISOString()}","${e.referrer || ''}"`
      )
    ].join('\n');

    const filename = `waitlist-${new Date().toISOString().split('T')[0]}.csv`;
    const filepath = path.join(waitlistDir, filename);
    fs.writeFileSync(filepath, csv);

    console.log(`✓ Exported ${entries.length} entries to ${filepath}`);
    console.log(`\nEntries:`);
    entries.forEach((e, i) => {
      console.log(`${i + 1}. ${e.email} ${e.name ? `(${e.name})` : ''} - ${e.createdAt.toISOString()}`);
    });

    await prisma.$disconnect();
  } catch (error) {
    console.error('Error exporting waitlist:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

exportWaitlist().then(() => process.exit(0));
