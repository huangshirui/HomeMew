import { Navigate, Route, Routes } from 'react-router-dom';
import { ActivityReporter } from './components/activity-reporter';
import { AppShell } from './components/app-shell';
import { HouseholdProvider } from './components/household-provider';
import { SessionGate } from './components/session-gate';
import { CalendarPage } from './pages/calendar-page';
import { DomainPage } from './pages/domain-page';
import { FootballPage } from './pages/football-page';
import { FootballManagePage } from './pages/football-manage-page';
import { DaysPage } from './pages/days-page';
import { FamilyPage } from './pages/family-page';
import { HomePage } from './pages/home-page';
import { IntegrationDetailPage } from './pages/integration-detail-page';
import { MorePage } from './pages/more-page';
import { SettingsPage } from './pages/settings-page';
import { TasksPage } from './pages/tasks-page';
import { WishesPage } from './pages/wishes-page';

export function App() {
  return (
    <SessionGate>
      <ActivityReporter />
      <HouseholdProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<HomePage />} />
            <Route path="calendar" element={<CalendarPage />} />
            <Route path="tasks" element={<TasksPage />} />
            <Route path="days" element={<DaysPage />} />
            <Route path="activities" element={<DomainPage modelKey="activity" />} />
            <Route path="activities/:recordId" element={<DomainPage modelKey="activity" />} />
            <Route path="goals" element={<DomainPage modelKey="goal" />} />
            <Route path="goals/:recordId" element={<DomainPage modelKey="goal" />} />
            <Route path="anniversaries" element={<DomainPage modelKey="anniversary" />} />
            <Route path="habits" element={<DomainPage modelKey="habit" />} />
            <Route path="habits/:recordId" element={<DomainPage modelKey="habit" />} />
            <Route path="football" element={<FootballPage />} />
            <Route path="football/:matchId" element={<FootballPage />} />
            <Route path="football/manage" element={<FootballManagePage />} />
            <Route path="wishes" element={<WishesPage />} />
            <Route path="family" element={<FamilyPage />} />
            <Route path="more" element={<MorePage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="settings/integrations" element={<SettingsPage section="integrations" />} />
            <Route path="settings/integrations/:integrationId" element={<IntegrationDetailPage />} />
          </Route>
          <Route path="*" element={<Navigate replace to="/" />} />
        </Routes>
      </HouseholdProvider>
    </SessionGate>
  );
}
