'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

// 🌟 智能翻译字典：彻底抛弃模糊匹配，只接受绝对干净的枚举值
const translateView = (view: string) => {
  const map: Record<string, string> = { front: '正面', side: '侧面', back: '背面' };
  return map[view] || '正面'; // 绝对匹配
};

// 🌟 双语分割渲染器
const renderBilingualPrompt = (text: string) => {
  if (!text) return '';
  if (text.includes('||')) {
    const [en, zh] = text.split('||');
    return (
      <div className="flex flex-col gap-1 mt-1">
        <span className="text-gray-800 font-bold not-italic">{zh.trim()}</span>
        <span className="text-gray-400 text-[10px] font-mono leading-tight">{en.trim()}</span>
      </div>
    );
  }
  return <span className="text-gray-500 font-mono italic">{text}</span>;
};

export default function ScriptEditor() {
  const [projectId, setProjectId] = useState(() => crypto.randomUUID());
  
  const [userPrompt, setUserPrompt] = useState('');
  const [scenes, setScenes] = useState<any[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isApproved, setIsApproved] = useState(false);
  
  const [userId, setUserId] = useState<string | null>(null);
  const [userTier, setUserTier] = useState<'basic' | 'pro'>('basic');

  useEffect(() => {
    const fetchUserAndTier = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUserId(user.id);
        const { data: profile } = await supabase.from('user_profiles').select('tier').eq('id', user.id).single();
        if (profile) setUserTier(profile.tier);
      }
    };
    fetchUserAndTier();
  }, []);

  const handleGenerateScript = async () => {
    if (!userId) return alert("请等待用户数据加载完成！");
    if (isApproved && !confirm("当前剧本已锁定，重新生成将覆盖旧数据并需要重新确认。确定吗？")) return;

    setIsGenerating(true);
    try {
      // 🌟 彻底拔除 status: 'pending'，不再触碰数据库的 ENUM 约束！
      const { error: draftError } = await supabase.from('video_projects').upsert({ 
          id: projectId, user_id: userId, title: '创作中的草稿', user_prompt: userPrompt
      }, { onConflict: 'id' });
      if (draftError) throw new Error("创建草稿失败: " + draftError.message);

      const { data, error } = await supabase.functions.invoke('step1-script', {
        body: { projectId, prompt: userPrompt, userId }
      });

      if (error || data?.error) throw error || new Error(data.error);
      
      setScenes(data.scenes);
      setIsApproved(false);
    } catch (err: any) { alert("生成失败: " + err.message); } 
    finally { setIsGenerating(false); }
  };

  const handleApprove = async () => {
    const title = window.prompt("剧本创作完成！请给它起个名字:");
    if (!title || title.trim() === '') return;

    try {
      // 🌟 彻底拔除 status: 'draft'，利用无状态智能分类！
      await supabase.from('video_projects').update({ title, user_prompt: userPrompt }).eq('id', projectId);
      await supabase.from('storyboards').update({ is_approved: true }).eq('project_id', projectId);
      setIsApproved(true);
      alert(`✅ 剧本 [${title}] 已成功入库！`);
    } catch (err: any) { alert("确认失败: " + err.message); }
  };

  const handleCreateNew = () => {
    setProjectId(crypto.randomUUID());
    setUserPrompt('');
    setScenes([]);
    setIsApproved(false);
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6 bg-white rounded-xl shadow-lg text-black">
      <div className="flex items-center justify-between border-b pb-4">
        <div>
           <h2 className="text-2xl font-black text-gray-800">1. 剧本分镜工作台</h2>
           <p className="text-xs text-gray-500 mt-1">支持首尾帧插值闭环管线 (Keyframe Interpolation Pipeline)</p>
        </div>
        {isApproved && (
          <div className="flex items-center gap-3">
            <span className="px-3 py-1.5 bg-green-100 text-green-700 text-sm rounded-full font-bold flex items-center gap-1">
              ✅ 已入库
            </span>
            <button onClick={handleCreateNew} className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-full shadow-md transition-colors">
              ➕ 开启新创作
            </button>
          </div>
        )}
      </div>
      
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-bold text-gray-600">创作提示词</label>
          {userTier === 'pro' && (
             <div className="px-3 py-1 bg-purple-50 rounded-full text-xs font-bold text-purple-600 animate-pulse">✨ Pro 模式：已激活一镜到底深度推演引擎</div>
          )}
        </div>

        <textarea
          className="w-full p-4 border-2 rounded-xl focus:ring-0 transition-all outline-none focus:border-purple-500 bg-gray-50"
          rows={3}
          placeholder="输入您的创意..."
          value={userPrompt}
          onChange={(e) => setUserPrompt(e.target.value)}
          disabled={isGenerating}
        />
        
        <button 
          onClick={handleGenerateScript} 
          disabled={!userPrompt || isGenerating || !userId} 
          className="w-full py-3.5 rounded-xl font-black text-lg text-white bg-gray-800 hover:bg-black transition-all disabled:opacity-50"
        >
          {isGenerating ? '🎬 剧本推演中...' : scenes.length > 0 ? '🔄 重新生成全部分镜' : '🎬 开始生成分镜脚本'}
        </button>
      </div>

      {scenes.length > 0 && (
        <div className="pt-6 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="grid gap-6">
            {scenes.map((scene, index) => {
              const isLastScene = index === scenes.length - 1;
              return (
              <div key={scene.scene_index} className="group p-6 bg-white shadow-sm border-2 rounded-2xl border-gray-100 hover:border-purple-300 transition-all">
                
                <div className="flex justify-between items-center mb-4 pb-3 border-b border-gray-100">
                  <div className="flex items-center gap-3">
                    <span className="px-4 py-1.5 text-white text-sm font-black rounded-lg bg-blue-600">🎬 SCENE {scene.scene_index}</span>
                    <span className="text-xs font-black uppercase px-3 py-1.5 rounded-lg bg-gray-50 border border-gray-200 text-gray-600">
                      🎥 {scene.camera_config?.movement || 'STATIC'}
                    </span>
                  </div>
                </div>
                
                <div className="space-y-3 mb-5">
                  <p className="text-gray-800 leading-relaxed font-medium text-lg">{scene.raw_script}</p>
                  {scene.dialogue_zh && scene.dialogue_zh.trim() !== "" && (
                    <div className="p-4 bg-blue-50/60 rounded-xl border border-blue-100/60 flex gap-3 items-start relative overflow-hidden">
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-400"></div>
                      <span className="text-blue-500 text-xl">💬</span>
                      <p className="text-base text-blue-900 font-bold">"{scene.dialogue_zh}"</p>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 bg-gray-50 p-4 rounded-xl border border-gray-200/60">
                  
                  <div className="p-4 bg-white rounded-lg border border-gray-200 shadow-sm flex flex-col h-full">
                    <div className="flex justify-between items-center mb-2 pb-2 border-b border-gray-100">
                      <span className="text-xs font-black text-gray-700">▶ 起点画面设定</span>
                      <span className="px-2 py-1 text-[10px] font-black rounded bg-blue-50 text-blue-600 border border-blue-100">
                        视角: {translateView(scene.start_frame_view)}
                      </span>
                    </div>
                    <div className="text-xs flex-1">{renderBilingualPrompt(scene.start_frame_prompt)}</div>
                  </div>

                  <div className="p-4 bg-white rounded-lg border border-gray-200 shadow-sm flex flex-col h-full relative overflow-hidden">
                    {isLastScene && <div className="absolute top-0 right-0 w-16 h-16 bg-red-50 text-red-500 rotate-45 translate-x-8 -translate-y-8 flex items-end justify-center pb-1 text-[10px] font-black">结局</div>}
                    <div className="flex justify-between items-center mb-2 pb-2 border-b border-gray-100">
                      <span className={`text-xs font-black ${isLastScene ? 'text-red-600' : 'text-gray-700'}`}>
                        ⏹ {isLastScene ? '大结局画面设定' : '终点画面设定'}
                      </span>
                      <span className={`px-2 py-1 text-[10px] font-black rounded ${isLastScene ? 'bg-red-50 text-red-600 border border-red-100' : 'bg-orange-50 text-orange-600 border border-orange-100'}`}>
                        视角: {translateView(scene.end_frame_view)}
                      </span>
                    </div>
                    <div className="text-xs flex-1">{renderBilingualPrompt(scene.end_frame_prompt)}</div>
                  </div>

                </div>
              </div>
            )})}
          </div>

          {!isApproved && (
            <div className="sticky bottom-4 z-10 bg-white/90 backdrop-blur-xl p-4 border border-gray-200 rounded-2xl flex shadow-[0_10px_40px_rgba(0,0,0,0.1)]">
              <button onClick={handleApprove} className="flex-1 py-4 bg-green-600 hover:bg-green-500 transition-colors text-white rounded-xl font-black text-lg shadow-lg">
                ✅ 完美闭环！将此剧本入库
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}