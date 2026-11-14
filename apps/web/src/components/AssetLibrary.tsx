import { useState } from 'react';
import type { Card } from '../types';
import { CardMedia } from './CardMedia';
import Icon from '../ui/Icon';

export default function AssetLibrary({
  cards,
  selected,
  onSelect,
  onUpload,
  onClose,
}: {
  cards: Card[];
  selected: string | null;
  onSelect: (card: Card) => void;
  onUpload: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const visible = cards.filter(card =>
    card.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <aside className="fo-assets-panel" aria-label="项目素材">
      <header>
        <h2>
          素材 <span>{cards.length}</span>
        </h2>
        <button
          type="button"
          className="fo-icon-button"
          aria-label="关闭素材面板"
          onClick={onClose}
        >
          <Icon name="x" />
        </button>
      </header>
      <button type="button" className="fo-library-upload" onClick={onUpload}>
        <Icon name="upload" />
        导入图片或视频
      </button>
      {!!cards.length && (
        <input
          type="search"
          aria-label="搜索项目素材"
          placeholder="搜索素材…"
          value={query}
          onChange={event => setQuery(event.target.value)}
        />
      )}
      <div className="fo-library-grid">
        {visible.map(card => (
          <button
            type="button"
            className={selected === card.id ? 'is-selected' : undefined}
            key={card.id}
            aria-label={`定位素材：${card.name}`}
            aria-pressed={selected === card.id}
            onClick={() => onSelect(card)}
          >
            <div className="fo-library-thumb">
              <CardMedia card={card} />
              <span>{card.kind === 'video' ? '视频' : '图片'}</span>
            </div>
            <span>{card.name}</span>
          </button>
        ))}
      </div>
      {!visible.length && (
        <p className="fo-library-empty">
          {cards.length ? '没有找到匹配的素材' : '导入或生成的素材会出现在这里。'}
        </p>
      )}
    </aside>
  );
}
