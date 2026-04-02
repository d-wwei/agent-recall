import React, { useMemo, useRef, useEffect } from 'react';
import { Observation, Summary, UserPrompt, FeedItem } from '../types';
import { ObservationCard } from './ObservationCard';
import { SummaryCard } from './SummaryCard';
import { PromptCard } from './PromptCard';
import { ScrollToTop } from './ScrollToTop';
import { UI } from '../constants/ui';

type TypeFilter = 'all' | 'observations' | 'summaries' | 'prompts';

interface FeedProps {
  observations: Observation[];
  summaries: Summary[];
  prompts: UserPrompt[];
  typeFilter?: TypeFilter;
  onLoadMore: () => void;
  isLoading: boolean;
  hasMore: boolean;
}

export function Feed({ observations, summaries, prompts, typeFilter = 'all', onLoadMore, isLoading, hasMore }: FeedProps) {
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const onLoadMoreRef = useRef(onLoadMore);

  // Keep the callback ref up to date
  useEffect(() => {
    onLoadMoreRef.current = onLoadMore;
  }, [onLoadMore]);

  // Set up intersection observer for infinite scroll
  useEffect(() => {
    const element = loadMoreRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (first.isIntersecting && hasMore && !isLoading) {
          onLoadMoreRef.current?.();
        }
      },
      { threshold: UI.LOAD_MORE_THRESHOLD }
    );

    observer.observe(element);

    return () => {
      if (element) {
        observer.unobserve(element);
      }
      observer.disconnect();
    };
  }, [hasMore, isLoading]);

  const items = useMemo<FeedItem[]>(() => {
    const combined: FeedItem[] = [];
    if (typeFilter === 'all' || typeFilter === 'observations') {
      combined.push(...observations.map(o => ({ ...o, itemType: 'observation' as const })));
    }
    if (typeFilter === 'all' || typeFilter === 'summaries') {
      combined.push(...summaries.map(s => ({ ...s, itemType: 'summary' as const })));
    }
    if (typeFilter === 'all' || typeFilter === 'prompts') {
      combined.push(...prompts.map(p => ({ ...p, itemType: 'prompt' as const })));
    }
    return combined.sort((a, b) => b.created_at_epoch - a.created_at_epoch);
  }, [observations, summaries, prompts, typeFilter]);

  return (
    <div className="feed" ref={feedRef}>
      <ScrollToTop targetRef={feedRef} />
      <div className="feed-content">
        {items.map(item => {
          const key = `${item.itemType}-${item.id}`;
          if (item.itemType === 'observation') {
            return <ObservationCard key={key} observation={item} />;
          } else if (item.itemType === 'summary') {
            return <SummaryCard key={key} summary={item} />;
          } else {
            return <PromptCard key={key} prompt={item} />;
          }
        })}
        {items.length === 0 && !isLoading && (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-3)' }}>
            No items to display
          </div>
        )}
        {isLoading && (
          <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-3)' }}>
            <span className="spinner" style={{ display: 'inline-block', marginRight: '10px' }}></span>
            Loading more...
          </div>
        )}
        {hasMore && !isLoading && items.length > 0 && (
          <div ref={loadMoreRef} style={{ height: '20px', margin: '10px 0' }} />
        )}
        {!hasMore && items.length > 0 && (
          <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-4)', fontSize: '12px', fontFamily: 'var(--mono)' }}>
            end of feed
          </div>
        )}
      </div>
    </div>
  );
}
