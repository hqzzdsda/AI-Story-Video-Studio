'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';

export default function CharacterSelector({ projectId }: { projectId: string }) {
  const [prompt, setPrompt] = useState('');
  const [candidateUrl, setCandidateUrl] = useState<string | null>(null); // 改为单张图
  const [translatedPrompt, setTranslatedPrompt] = useState<string>('');
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isLocked, setIsLocked] = useState(false);

  const [userId, setUserId] = useState<string | null>(null);
  const [userTier, setUserTier] = useState<'basic' | 'pro'>('basic');
  
  const [referenceImageUrl, setReferenceImageUrl] = useState<string | null>(null);
  const [storageFilePath, setStorageFilePath] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !userId) return;
    if (file.size > 5 * 1024 * 1024) return alert("请上传 5MB 以内的图片");

    setIsUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const filePath = `${userId}-${Date.now()}.${fileExt}`;
      const { error: uploadError } = await supabase.storage.from('temp_refs').upload(filePath, file);
      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage.from('temp_refs').getPublicUrl(filePath);
      setReferenceImageUrl(publicUrl);
      setStorageFilePath(filePath); 
    } catch (error: any) {
      alert("上传失败: " + error.message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    setCandidateUrl(null);
    try {
      const { data, error } = await supabase.functions.invoke('step2-character', {
        body: { projectId, prompt, userId, referenceImageUrl }
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      
      if (data.images && data.images.length > 0) {
        setCandidateUrl(data.images[0]);
      }
      // 🌟 接收后端大模型翻译好的极品英文
      if (data.translated_prompt) {
        setTranslatedPrompt(data.translated_prompt);
      }
      
    } catch (err: any) {
      alert("图片生成失败，请重试！");
    } finally {
      setIsGenerating(false);
    }
  };

  // 🌟 核心重构：将临时图片转存至私有保险库
  const handleLockCharacter = async () => {
    if (!candidateUrl || !userId) return;

    try {
      // 1. 将公开的临时图片下载为 Blob 数据
      const imgResponse = await fetch(candidateUrl);
      const imgBlob = await imgResponse.blob();

      // 2. 构建安全的私有路径 (严格隔离：userId / 文件名)
      // 🌟 同步后端的终极优化，将后缀强制改为 .jpg
      const privatePath = `${userId}/char_front_${Date.now()}.jpg`;

      // 3. 上传到私有保险库 (user_assets)
      // 🌟 同步修改 contentType
      const { error: uploadError } = await supabase.storage
        .from('user_assets')
        .upload(privatePath, imgBlob, { contentType: 'image/jpeg' });

      if (uploadError) throw uploadError;

      // 4. 将【私有路径】存入主表 characters
      const { data: charData, error: charError } = await supabase
        .from('characters')
        .insert({
            name: '未命名主角',
            base_description: prompt, // 用户输入的中文 (留作 UI 展示和后续修改参考)
            base_description_en: translatedPrompt || prompt, // 🌟 专门喂给 Flux 的极品英文
            anchor_image_url: privatePath, 
            is_verified: true
        })
        .select().single();

      if (charError) throw charError;

      // 🌟 5. 【核心新增】同步在 character_views 里建立一张 'front' 视图档案！
      // 这样多视图数据库就彻底完整了！
      const { error: viewError } = await supabase
        .from('character_views')
        .insert({
            character_id: charData.id,
            image_url: privatePath,
            view_tag: 'front',
            is_derived: false // 标记它为原生基准图，不是 AI 推导出来的
        });
        
      if (viewError) throw viewError;

      // 6. 绑定给项目
      await supabase.from('video_projects').update({ character_id: charData.id }).eq('id', projectId);

      // 7. 销毁 temp_refs 里的临时文件
      if (storageFilePath) {
         await supabase.storage.from('temp_refs').remove([storageFilePath]);
      }

      setIsLocked(true);
      alert("✅ 角色资产已安全存入您的私有保险库，并成功注册为三视图正面基准！");
      
    } catch (error: any) {
      alert("入库失败: " + error.message);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6 bg-white rounded-xl shadow-lg text-black mt-8">
      <div className="flex items-center justify-between border-b pb-4">
        <h2 className="text-2xl font-bold text-gray-800">2. 角色形象构建 (图生图)</h2>
        {isLocked && <span className="px-3 py-1 bg-green-100 text-green-700 text-sm rounded-full font-medium">● 形象已锁定</span>}
      </div>

      <div className="space-y-4">
        {/* 上传区 */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-500">上传人脸参考图 (将提取长相，阅后即焚)</label>
          <div className="flex items-center gap-4">
            <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleImageUpload} disabled={isUploading || isGenerating || isLocked} />
            <button 
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading || isGenerating || isLocked}
              className="px-4 py-2 border-2 border-dashed border-blue-300 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors"
            >
              {isUploading ? '正在上传...' : referenceImageUrl ? '更换参考图' : '+ 选择照片'}
            </button>
            {referenceImageUrl && <img src={referenceImageUrl} alt="参考图" className="w-16 h-16 object-cover rounded-md border-2 border-green-400 shadow-sm" />}
          </div>
        </div>

        {/* 提示词输入区 */}
        <div className="space-y-2">
           <label className="text-sm font-medium text-gray-500">微调指令 (描述发型、服装、画风等)</label>
          <textarea
            className="w-full p-4 border-2 rounded-xl outline-none focus:border-blue-500 border-gray-100"
            rows={2}
            placeholder="例如：穿上赛博朋克皮衣，背景是纯色，3D动漫风格..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={isGenerating || isLocked}
          />
        </div>
        
        {/* 只有在没有生成出图片的时候，才显示初始的“生成”按钮 */}
        {!isLocked && !candidateUrl && (
          <button 
            onClick={handleGenerate} 
            disabled={(!prompt && !referenceImageUrl) || isGenerating}
            className={`w-full py-4 rounded-xl font-bold transition-all text-white ${userTier === 'pro' ? 'bg-gradient-to-r from-purple-600 to-indigo-600' : 'bg-gray-800'} disabled:opacity-50`}
          >
            {isGenerating ? '🎨 正在提取面部并重绘 (约需 15-30 秒)...' : '✨ 开始生成正面形象'}
          </button>
        )}
      </div>

      {/* 🌟 结果展示与重新生成交互区 */}
      {candidateUrl && !isLocked && (
        <div className="pt-8 space-y-6 animate-in fade-in">
          <div className="text-center">
            <p className="text-lg font-bold text-gray-800">提取结果预览</p>
            <p className="text-sm text-gray-500 mt-1">您可以直接锁定此形象，或重新抽卡</p>
          </div>

          <div className="max-w-md mx-auto relative rounded-2xl overflow-hidden shadow-2xl border-4 border-gray-100 aspect-square">
             {isGenerating && (
                <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-10">
                   <div className="text-white font-bold animate-pulse">重新生成中...</div>
                </div>
             )}
            <img src={candidateUrl} alt="生成的正面图" className="w-full h-full object-cover" />
          </div>

          {/* 🌟 并排的操作按钮 */}
          <div className="max-w-md mx-auto flex gap-4 pt-2">
            <button 
              onClick={handleLockCharacter} 
              disabled={isGenerating}
              className="flex-1 py-4 bg-green-600 hover:bg-green-700 text-white rounded-xl font-black shadow-lg transition-transform active:scale-95 flex flex-col items-center justify-center leading-tight"
            >
              <span>✅ 确认使用</span>
              <span className="text-[10px] font-normal opacity-80">(并销毁原参考图)</span>
            </button>
            
            <button 
              onClick={handleGenerate} 
              disabled={isGenerating}
              className="flex-1 py-4 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-xl font-bold shadow-sm transition-transform active:scale-95"
            >
              🔄 不满意，重新生成
            </button>
          </div>
        </div>
      )}

      {/* 锁定后的展示 */}
      {isLocked && candidateUrl && (
        <div className="mt-6 flex flex-col items-center p-6 bg-gray-50 rounded-xl border border-gray-200">
          <img src={candidateUrl} alt="已锁定主角" className="w-48 h-48 rounded-2xl shadow-md object-cover border-4 border-white" />
          <p className="mt-4 font-bold text-gray-800">这就是我们故事的主角了！</p>
        </div>
      )}
    </div>
  );
}