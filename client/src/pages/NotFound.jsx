import { Link } from 'react-router-dom';
import { useI18n } from '../lib/i18n.jsx';
import { EmptyState } from '../components/ui.jsx';

export default function NotFound() {
  const { t } = useI18n();
  return (
    <EmptyState
      icon="alert"
      title={t('Page not found')}
      text={t('The page you are looking for does not exist.')}
      action={
        <Link to="/" className="btn btn-primary">
          {t('Go to Home')}
        </Link>
      }
    />
  );
}
