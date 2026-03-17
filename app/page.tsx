'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import ScriptEditor from '@/components/ScriptEditor';
import CharacterSelector from '@/components/CharacterSelector';
import MultiviewGenerator from '@/components/MultiviewGenerator';
import VideoRenderBoard from '@/components/VideoRenderBoard';
import AssetLibrary from '@/components/AssetLibrary'; 

export default function Home() {
  const [activeTab, setActiveTab] = useState('assets');
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserId(user.id);
    });
  }, []);

  const navItems = [
    { id: 'assets', icon: '🗂️', label: '我的资产库' },
    { id: 'script', icon: '📝', label: '1. 剧本创作' },
    { id: 'character', icon: '👤', label: '2. 角色定妆' },
    { id: 'multiview', icon: '🧊', label: '3. 三视图构建' },
    { id: 'render', icon: '🎬', label: '4. 视频总控台' },
  ];

  if (!userId) return <div className="p-10 text-center">请先登录...</div>;

  return (
    <div className="flex h-[calc(100vh-64px)] bg-gray-50 overflow-hidden">
      <aside className="w-64 bg-gray-900 text-white flex flex-col shadow-2xl z-10">
        <div className="p-6">
          <h2 className="text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
            STUDIO WORKFLOW
          </h2>
        </div>
        <nav className="flex-1 px-4 space-y-2">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all ${
                activeTab === item.id 
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20' 
                  : 'text-gray-400 hover:bg-gray-800 hover:text-white'
              }`}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="flex-1 overflow-y-auto p-8 relative">
        <div className="max-w-5xl mx-auto w-full pb-32">
          {activeTab === 'assets' && <AssetLibrary userId={userId} />}
          {/* 🌟 这里的 ScriptEditor 不再需要外部传入 projectId */}
          {activeTab === 'script' && <ScriptEditor />}
          {activeTab === 'character' && <CharacterSelector />}
          {activeTab === 'multiview' && <MultiviewGenerator />}
          {activeTab === 'render' && <VideoRenderBoard userId={userId} />}
        </div>
      </main>
    </div>
  );
}