import { useCallback, useEffect, useState } from '@lynx-js/react';

import arrow from '../../assets/arrow.png';
import lynxLogo from '../../assets/lynx-logo.png';
import reactLynxLogo from '../../assets/react-logo.png';
import { useFlappy } from '../../useFlappy.js';
import './HomePage.css';

/** 首页:create-lynx 自带的 flappy 示例,从原 src/App.tsx 迁入。 */
export function HomePage() {
  const [alterLogo, setAlterLogo] = useState(false);
  const [logoY, jump] = useFlappy();

  useEffect(() => {
    console.info('Hello, ReactLynx');
  }, []);

  const onTap = useCallback(() => {
    'background only';
    setAlterLogo((prevAlterLogo) => !prevAlterLogo);
  }, []);

  return (
    <view bindtap={jump}>
      <view className="Background" />
      <view className="App">
        <view className="Banner">
          <view
            className="Logo"
            style={{ transform: `translateY(${logoY}px)` }}
            bindtap={onTap}
          >
            {alterLogo ? (
              <image src={reactLynxLogo} className="Logo--react" />
            ) : (
              <image src={lynxLogo} className="Logo--lynx" />
            )}
          </view>
          <text className="Title">React</text>
          <text className="Subtitle">on Lynx</text>
        </view>
        <view className="Content">
          <image src={arrow} className="Arrow" />
          <text className="Description">Tap the logo and have fun!</text>
        </view>
      </view>
    </view>
  );
}
