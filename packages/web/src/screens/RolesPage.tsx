import { Screen } from '../App';
import { RoleReference } from '../components/RoleReference';
import { TopBar } from '../components/TopBar';
import { t } from '../i18n';
import { navigate } from '../router';

export function RolesPage() {
  return (
    <Screen className="safe-bottom">
      <TopBar title={t.home.rules} onBack={() => (window.history.length > 1 ? window.history.back() : navigate('/'))} />
      <div className="pb-8">
        <RoleReference />
      </div>
    </Screen>
  );
}
