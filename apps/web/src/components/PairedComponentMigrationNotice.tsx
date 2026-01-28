import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { FaWrench } from 'react-icons/fa';

interface PairedComponentMigrationNoticeProps {
  isOpen: boolean;
  onReviewNow: () => void;
  onMaybeLater: () => void;
}

export function PairedComponentMigrationNotice({
  isOpen,
  onReviewNow,
  onMaybeLater,
}: PairedComponentMigrationNoticeProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onMaybeLater}
      title="Component Tracking Update"
      size="md"
      showCloseButton={false}
    >
      <div className="space-y-4">
        <div className="flex items-center gap-3 text-primary">
          <FaWrench size={24} />
          <span className="text-lg font-medium">Front & Rear Tracking</span>
        </div>

        <p className="text-white">
          We now track front and rear components separately for:
        </p>

        <ul className="list-disc list-inside text-white/80 space-y-1 ml-2">
          <li>Tires</li>
          <li>Brake Pads</li>
          <li>Brake Rotors</li>
          <li>Brakes</li>
        </ul>

        <p className="text-white/70 text-sm">
          Your existing components have been duplicated as "same front & rear" by default.
        </p>

        <p className="text-white/70 text-sm">
          If your front and rear components are different (e.g., Assegai front / DHR II rear),
          you can update them now or anytime from your Gear page.
        </p>

        <div className="flex justify-center gap-3 pt-4">
          <Button variant="outline" size="sm" onClick={onMaybeLater}>
            Maybe Later
          </Button>
          <Button variant="primary" size="sm" onClick={onReviewNow}>
            Review Components Now
          </Button>
        </div>
      </div>
    </Modal>
  );
}
