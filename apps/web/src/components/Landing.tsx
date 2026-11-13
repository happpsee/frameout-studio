import { useRef } from 'react';
import Icon from './Icon';
import { useLandingMotion } from '../hooks/useLandingMotion';
import { requestExample } from '../lib/examples';
import '../styles/landing-zh.css';
import '../styles/landing-examples.css';

interface LandingProps {
  onOpenStudio: () => void;
}
const ASSETS = '/assets/';
const INSPIRATION_FRAMES = [
  {
    id: 'forest' as const,
    image: 'forest-astronaut-960.webp',
    alt: '森林中的橙色头盔探索者',
    name: '森林来信',
    note: '薄雾 · 森林',
    tag: '科幻 / 自然',
  },
  {
    id: 'ocean' as const,
    image: 'still-ocean.webp',
    alt: '涌动的蓝绿色海浪',
    name: '潮汐之后',
    note: '浪花 · 蓝绿',
    tag: '情绪 / 纪录',
  },
  {
    id: 'city' as const,
    image: 'still-city.webp',
    alt: '夜色城市的光影',
    name: '夜游计划',
    note: '夜色 · 城市',
    tag: '城市 / 漫游',
  },
];

function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 44 44" fill="none" aria-hidden="true">
      <path
        d="M3 3h15v5H8v10H3V3Zm23 0h15v15h-5V8H26V3ZM3 26h5v10h10v5H3V26Zm33 0h5v15H26v-5h10V26Z"
        fill="currentColor"
      />
      <path d="m18 14 13 8-13 8V14Z" fill="currentColor" />
    </svg>
  );
}

function DisplayLine({ text, className = '' }: { text: string; className?: string }) {
  return (
    <span className={`motion-line ${className}`} aria-hidden="true">
      <span className="motion-line-inner">
        {Array.from(text, (letter, index) => (
          <span className="motion-letter" key={index}>
            {letter === ' ' ? '\u00a0' : letter}
          </span>
        ))}
      </span>
    </span>
  );
}

const PHASE_TEXT = ['先让想法，自由散落。', '找到故事的第一个画面。', '把镜头，连成你的故事。'];
const PHASE_SAVE = ['给想法留点空间', '找到你的主镜头', '镜头已连成故事'];

function CanvasPreview({ onOpenStudio, phase }: LandingProps & { phase: number }) {
  return (
    <div className="motion-stage">
      <div className="motion-sticky">
        <div className="canvas-preview" id="canvas-preview">
          <div className="preview-topbar">
            <span className="preview-project">
              <Icon name="folder" /> 森林来信 <span className="preview-separator">/</span>
              <span>画布示意</span>
            </span>
            <span className="preview-save">
              <i className="status-dot" />
              <span>{PHASE_SAVE[phase]}</span>
            </span>
          </div>
          <div className="preview-body">
            <span className="preview-label">氛围与瞬间</span>
            <div className="preview-group">
              <span>森林来信 / 视觉探索</span>
            </div>
            <div className="preview-note">
              不急着定稿。
              <br />
              <span>先看看还有什么可能。</span>
              <i aria-hidden="true">↘</i>
            </div>
            <div className="preview-image preview-image-main">
              <img
                src={`${ASSETS}forest-astronaut-960.webp`}
                alt="探索者穿行森林的电影画面"
                loading="lazy"
              />
              <span>
                <i className="status-dot" /> 森林来信 <small>构图参考</small>
              </span>
            </div>
            <div className="preview-image preview-image-detail">
              <img
                src={`${ASSETS}forest-astronaut-960.webp`}
                alt="森林薄雾与探索者的局部取景"
                loading="lazy"
              />
              <span>换个角度</span>
            </div>
            <div className="preview-image preview-image-ocean">
              <img src={`${ASSETS}still-ocean.webp`} alt="海面与浪花的灵感素材" loading="lazy" />
              <span>也许，去海边。</span>
            </div>
            <div className="preview-cursor" aria-hidden="true">
              <svg viewBox="0 0 24 28">
                <path
                  d="m2 2 18 15-9 1-5 8Z"
                  fill="currentColor"
                  stroke="#151613"
                  strokeWidth="1.5"
                />
              </svg>
              <span>你的下一个想法</span>
            </div>
            <button className="preview-entry button button-lime" onClick={() => onOpenStudio()}>
              打开创作画布 <Icon name="maximize" />
            </button>
            <div className="motion-timeline" aria-hidden="true">
              {['forest-astronaut-960.webp', 'forest-astronaut-960.webp', 'still-ocean.webp'].map(
                (image, index) => (
                  <div className="motion-timeline-shot" key={index}>
                    <img src={`${ASSETS}${image}`} alt="" loading="lazy" />
                    <span>镜头 0{index + 1}</span>
                  </div>
                ),
              )}
              <i className="motion-playhead" />
            </div>
          </div>
          <div className="preview-bottom">
            <span>参考图</span>
            <Icon name="plus" />
            <span>镜头草稿</span>
            <Icon name="plus" />
            <span>一闪而过的灵感</span>
            <span className="preview-zoom">
              67% <Icon name="minus" />
              <Icon name="plus" />
            </span>
          </div>
        </div>
        <div className="motion-story-status">
          <div className="motion-story-heading">
            <b>0{phase + 1}</b>
            <span>{PHASE_TEXT[phase]}</span>
          </div>
          <div className="motion-story-track" aria-hidden="true">
            {['01 / 探索', '02 / 定格', '03 / 成片'].map((label, index) => (
              <span className={phase === index ? 'active' : undefined} key={label}>
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Landing({ onOpenStudio }: LandingProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const { replayEntrance, phase } = useLandingMotion(rootRef);

  return (
    <div id="landing" ref={rootRef}>
      <a className="skip-link" href="#main">
        跳到主要内容
      </a>
      <header className="site-header">
        <a className="brand" href="#" aria-label="帧外 FRAMEOUT 首页">
          <BrandMark />
          <span className="brand-word">
            FRAMEOUT<span className="brand-zh">帧外</span>
          </span>
        </a>
        <nav className="header-nav" aria-label="主要导航">
          <a href="#how">创作方式</a>
          <a href="#showcase">灵感片场</a>
          <span className="nav-dot" aria-hidden="true" />
          <span className="prototype-label">影像工作台</span>
        </nav>
        <button className="button button-lime header-start" onClick={() => onOpenStudio()}>
          开始创作 <Icon name="arrow-up-right" />
        </button>
      </header>

      <main id="main">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-topline">
            <span>
              <i className="status-dot" /> 给下一部短片的试验场
            </span>
            <span>想象之外，自由之内。</span>
          </div>
          <div className="hero-layout">
            <div className="hero-copy">
              <div className="headline-wrap">
                <h1 id="hero-title" aria-label="拍一场好戏。">
                  <DisplayLine text="拍一场" />
                  <DisplayLine text="好戏。" className="lime-text" />
                </h1>
                <span className="hero-sticker" aria-hidden="true">
                  <svg viewBox="0 0 110 110">
                    <path
                      d="m55 2 10 27 26-13-13 27 30 12-30 11 13 27-26-13-10 28-11-28-27 13 13-27L2 55l28-12-13-27 27 13Z"
                      fill="currentColor"
                    />
                    <path
                      d="M39 46v5m30-5v5M36 63q19 20 38 0"
                      stroke="#151613"
                      strokeWidth="4"
                      strokeLinecap="round"
                      fill="none"
                    />
                  </svg>
                  <span>
                    保持
                    <br />
                    好奇
                  </span>
                </span>
              </div>
              <p className="hero-outline" aria-hidden="true">
                随你拍。
              </p>
              <div className="hero-description">
                <h2>
                  把灵感摊开。
                  <br />
                  让故事发生。
                </h2>
                <p>
                  从一张图，到一个镜头，再到你的故事。
                  <br />
                  在自由画布上，让每一个想法都有位置。
                </p>
              </div>
              <div className="hero-actions">
                <button className="button button-lime button-large" onClick={() => onOpenStudio()}>
                  打开创作画布 <Icon name="arrow-up-right" />
                </button>
                <span className="hero-action-note">
                  自由探索 · 随时撤销
                  <br />
                  <small>生成图片与视频 · 需要自备 API Key</small>
                </span>
              </div>
              <p className="hero-fit">
                适合想自己挑画面、排镜头的创作者。开始前需要一个火山方舟或 OpenAI 的 API
                Key，按次付费；导出的成片保留视频自带的声音，暂不支持配乐和字幕。
              </p>
            </div>
            <div className="hero-art" id="hero-art">
              <span className="art-coordinate coordinate-top">[ 想法 → 画面 ]</span>
              <div className="orbit-ring" aria-hidden="true" />
              <div className="art-cross cross-one" aria-hidden="true">
                +
              </div>
              <div className="art-cross cross-two" aria-hidden="true">
                +
              </div>
              <div className="hero-photo-frame">
                <div className="film-top">
                  <span>
                    <i /> 画面练习 / 001
                  </span>
                  <span>16:9</span>
                </div>
                <div className="hero-photo">
                  <img
                    src={`${ASSETS}forest-astronaut.webp`}
                    srcSet={`${ASSETS}forest-astronaut-960.webp 960w, ${ASSETS}forest-astronaut.webp 1672w`}
                    sizes="(max-width: 900px) 100vw, 60vw"
                    alt="戴橙色头盔的探索者站在薄雾森林中，原创科幻电影感画面"
                    width="1672"
                    height="941"
                    fetchPriority="high"
                  />
                  {['tl', 'tr', 'bl', 'br'].map(position => (
                    <div className={`viewfinder-corner ${position}`} key={position} />
                  ))}
                  <span className="image-caption">
                    森林来信<span>示例画面</span>
                  </span>
                </div>
                <div className="film-bottom">
                  <span>日 / 外 / 森林</span>
                  <span>想法的第一个画面。 ↗</span>
                </div>
              </div>
              <div className="floating-note">
                <span className="note-pin" aria-hidden="true" />
                <span>如果……</span>
                <p>
                  森林里，
                  <br />
                  来了一位宇航员。
                </p>
                <svg viewBox="0 0 100 40" aria-hidden="true">
                  <path
                    d="M4 9q33 39 82 7m-6-8 12 6-8 11"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
              <div className="mini-frame">
                <img src={`${ASSETS}still-ocean.webp`} alt="蓝绿色海浪" width="300" height="200" />
                <span>潮汐之后</span>
              </div>
              <span className="art-coordinate coordinate-bottom">拖动想法，连成故事。</span>
            </div>
          </div>
          <div className="hero-footer">
            <span className="scroll-cue">
              <Icon name="arrow-down" /> 向下探索
            </span>
            <span>自由画布 / AI 影像 / 镜头编排</span>
            <button
              className="motion-replay"
              aria-label="重新播放首页开场动画"
              onClick={() => {
                window.scrollTo({ top: 0, behavior: 'instant' });
                replayEntrance();
              }}
            >
              <Icon name="undo" />
              <span>重播开场</span>
            </button>
          </div>
        </section>

        <div className="marquee" aria-hidden="true">
          <div className="marquee-track">
            {[0, 1].map(index => (
              <span style={{ display: 'contents' }} key={index}>
                <span>给想法多留点地方</span>
                <span className="marquee-spark">✳</span>
                <span className="outline-ink">创作少一点阻碍</span>
                <span className="marquee-spark">✳</span>
              </span>
            ))}
          </div>
        </div>

        <section className="canvas-section paper-section" id="how" aria-labelledby="canvas-title">
          <div className="section-heading">
            <div>
              <span className="eyebrow">照你的思路来</span>
              <h2 id="canvas-title">
                思路自由，
                <br />
                画布也是。
              </h2>
            </div>
            <div className="section-intro">
              <p>
                把参考、尝试和意外惊喜放在一起。
                <br />
                随手摆，放心试，慢慢找到故事的样子。
              </p>
              <button className="text-button" onClick={() => onOpenStudio()}>
                进去动手试试 <Icon name="arrow-up-right" />
              </button>
            </div>
          </div>
          <CanvasPreview onOpenStudio={onOpenStudio} phase={phase} />
          <div className="process-list">
            <article>
              <span className="process-number">01 / 探索</span>
              <h3>先有一个画面。</h3>
              <p>
                写下一点想象，或放进一张参考。
                <br />
                从任何地方开始，都算开始。
              </p>
            </article>
            <article>
              <span className="process-number">02 / 尝试</span>
              <h3>给它一点变化。</h3>
              <p>
                试构图，换氛围，让画面动起来。
                <br />
                好的版本留下，其他的也不必丢。
              </p>
            </article>
            <article>
              <span className="process-number">03 / 成片</span>
              <h3>把镜头连成故事。</h3>
              <p>
                挑选、排序、调整节奏。
                <br />
                让散落的灵感，有一个完整的表达。
              </p>
            </article>
          </div>
        </section>

        <section className="showcase-section" id="showcase" aria-labelledby="showcase-title">
          <div className="section-heading">
            <div>
              <span className="eyebrow">几个起点</span>
              <h2 id="showcase-title">
                先从一个
                <br />
                <span className="lime-text">“万一呢？”</span>
              </h2>
            </div>
            <p className="showcase-intro">
              森林、潮汐和夜色。
              <br />
              你的第一个镜头会从哪里开始？
            </p>
          </div>
          <div className="showcase-grid">
            {INSPIRATION_FRAMES.map(frame => (
              <button
                type="button"
                className="showcase-card"
                key={frame.id}
                aria-label={`打开示例「${frame.name}」`}
                onClick={() => {
                  requestExample(frame.id);
                  onOpenStudio();
                }}
              >
                <span className="showcase-image">
                  <img src={`${ASSETS}${frame.image}`} alt={frame.alt} loading="lazy" />
                  <span className="showcase-tag">{frame.tag}</span>
                </span>
                <span className="showcase-meta">
                  <span>
                    {frame.name}
                    <small>{frame.note}</small>
                  </span>
                  <span>
                    打开示例 <Icon name="arrow-up-right" />
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="final-cta" aria-labelledby="cta-title">
          <div className="cta-topline">
            <span>下一个画面，在等你。</span>
            <span>没有标准答案，只有你的版本。</span>
          </div>
          <div className="cta-main">
            <h2 id="cta-title">
              让它
              <br />
              <span className="outline-ink">发生。</span>
            </h2>
            <button className="cta-circle" onClick={() => onOpenStudio()} aria-label="打开创作画布">
              <Icon name="arrow-up-right" />
              <span>开始创作</span>
            </button>
          </div>
          <div className="cta-bottom">
            <span>把没说完的故事，交给画面。</span>
            <span>画布上见。 ↗</span>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <a className="brand footer-brand" href="#">
          <span className="footer-brand-word">
            FRAMEOUT<span>帧外</span>
          </span>
        </a>
        <div>
          <span>一个关于影像与自由想象的实验。</span>
          <span>© 2026 FRAMEOUT · 影像工作台</span>
        </div>
        <a href="#main" className="back-to-top">
          回到顶部 <Icon name="arrow-up" />
        </a>
      </footer>
      <div className="motion-scroll-line" aria-hidden="true" />
    </div>
  );
}
