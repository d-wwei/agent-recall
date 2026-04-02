import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Header } from './components/Header';
import { Toolbar } from './components/Toolbar';
import { Feed } from './components/Feed';
import { SessionView } from './components/SessionView';
import { CommandPalette } from './components/CommandPalette';
import { ContextSettingsModal } from './components/ContextSettingsModal';
import { LogsDrawer } from './components/LogsModal';
import { useSSE } from './hooks/useSSE';
import { useSettings } from './hooks/useSettings';
import { useStats } from './hooks/useStats';
import { usePagination } from './hooks/usePagination';
import { useTheme } from './hooks/useTheme';
import { useCommandPalette } from './hooks/useCommandPalette';
import { Observation, Summary, UserPrompt } from './types';
import { mergeAndDeduplicateByProject } from './utils/data';

export function App() {
  const [currentFilter, setCurrentFilter] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logsModalOpen, setLogsModalOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState<'all' | 'observations' | 'summaries' | 'prompts'>('all');
  const [viewMode, setViewMode] = useState<'timeline' | 'sessions'>('timeline');
  const [paginatedObservations, setPaginatedObservations] = useState<Observation[]>([]);
  const [paginatedSummaries, setPaginatedSummaries] = useState<Summary[]>([]);
  const [paginatedPrompts, setPaginatedPrompts] = useState<UserPrompt[]>([]);

  const { observations, summaries, prompts, projects, isProcessing, queueDepth, isConnected } = useSSE();
  const { settings, saveSettings, isSaving, saveStatus } = useSettings();
  useStats(); // keep polling stats for SSE connection
  const { preference, setThemePreference } = useTheme();
  const { isOpen: searchOpen, open: openSearch, close: closeSearch, toggle: toggleSearch } = useCommandPalette();
  const pagination = usePagination(currentFilter);

  // Merge SSE live data with paginated data, filtering by project when active
  const allObservations = useMemo(() => {
    const live = currentFilter
      ? observations.filter(o => o.project === currentFilter)
      : observations;
    return mergeAndDeduplicateByProject(live, paginatedObservations);
  }, [observations, paginatedObservations, currentFilter]);

  const allSummaries = useMemo(() => {
    const live = currentFilter
      ? summaries.filter(s => s.project === currentFilter)
      : summaries;
    return mergeAndDeduplicateByProject(live, paginatedSummaries);
  }, [summaries, paginatedSummaries, currentFilter]);

  const allPrompts = useMemo(() => {
    const live = currentFilter
      ? prompts.filter(p => p.project === currentFilter)
      : prompts;
    return mergeAndDeduplicateByProject(live, paginatedPrompts);
  }, [prompts, paginatedPrompts, currentFilter]);

  // Toggle settings modal
  const toggleSettings = useCallback(() => {
    setSettingsOpen(prev => !prev);
  }, []);

  // Toggle logs modal
  const toggleLogsModal = useCallback(() => {
    setLogsModalOpen(prev => !prev);
  }, []);

  // Handle loading more data
  const handleLoadMore = useCallback(async () => {
    try {
      const [newObservations, newSummaries, newPrompts] = await Promise.all([
        pagination.observations.loadMore(),
        pagination.summaries.loadMore(),
        pagination.prompts.loadMore()
      ]);

      if (newObservations.length > 0) {
        setPaginatedObservations(prev => [...prev, ...newObservations as Observation[]]);
      }
      if (newSummaries.length > 0) {
        setPaginatedSummaries(prev => [...prev, ...newSummaries as Summary[]]);
      }
      if (newPrompts.length > 0) {
        setPaginatedPrompts(prev => [...prev, ...newPrompts as UserPrompt[]]);
      }
    } catch (error) {
      console.error('Failed to load more data:', error);
    }
  }, [currentFilter, pagination.observations, pagination.summaries, pagination.prompts]);

  // Reset paginated data and load first page when filter changes
  useEffect(() => {
    setPaginatedObservations([]);
    setPaginatedSummaries([]);
    setPaginatedPrompts([]);
    handleLoadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFilter]);

  return (
    <>
      <Header
        isConnected={isConnected}
        projects={projects}
        currentFilter={currentFilter}
        onFilterChange={setCurrentFilter}
        isProcessing={isProcessing}
        queueDepth={queueDepth}
        themePreference={preference}
        onThemeChange={setThemePreference}
        onSettingsToggle={toggleSettings}
        onSearchToggle={toggleSearch}
      />

      <Toolbar
        observations={allObservations}
        summaries={allSummaries}
        prompts={allPrompts}
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />

      {viewMode === 'sessions' ? (
        <SessionView projectFilter={currentFilter} />
      ) : (
        <Feed
          observations={allObservations}
          summaries={allSummaries}
          prompts={allPrompts}
          typeFilter={typeFilter}
          onLoadMore={handleLoadMore}
          isLoading={pagination.observations.isLoading || pagination.summaries.isLoading || pagination.prompts.isLoading}
          hasMore={pagination.observations.hasMore || pagination.summaries.hasMore || pagination.prompts.hasMore}
        />
      )}

      <CommandPalette isOpen={searchOpen} onClose={closeSearch} />

      <ContextSettingsModal
        isOpen={settingsOpen}
        onClose={toggleSettings}
        settings={settings}
        onSave={saveSettings}
        isSaving={isSaving}
        saveStatus={saveStatus}
      />

      <button
        className="console-toggle-btn"
        onClick={toggleLogsModal}
        title="Toggle Console"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 17 10 11 4 5"></polyline>
          <line x1="12" y1="19" x2="20" y2="19"></line>
        </svg>
      </button>

      <LogsDrawer
        isOpen={logsModalOpen}
        onClose={toggleLogsModal}
      />
    </>
  );
}
