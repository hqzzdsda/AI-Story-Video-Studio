'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';

export default function ProfilePage() {
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [newPassword, setNewPassword] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetchUserData();
  }, []);

  const fetchUserData = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push('/auth');
      return;
    }
    setUser(user);

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', user.id)
      .single();
    setProfile(profile);
  };

  // 1. 修改密码逻辑
  const handleUpdatePassword = async () => {
    if (newPassword.length < 6) return alert('密码至少6位');
    setIsUpdating(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) alert(error.message);
    else {
      alert('密码修改成功！');
      setNewPassword('');
    }
    setIsUpdating(false);
  };

  // 2. 随意切换套餐逻辑 (测试模式)
  const toggleTier = async () => {
    const nextTier = profile.tier === 'basic' ? 'pro' : 'basic';
    const { error } = await supabase
      .from('user_profiles')
      .update({ tier: nextTier })
      .eq('id', user.id);

    if (!error) {
        setProfile({ ...profile, tier: nextTier });
        alert(`已切换至 ${nextTier.toUpperCase()} 模式，界面即将刷新以同步权限。`);
        
        // 🌟 加上这一行：强制刷新当前页面，让 Navbar 重新从数据库拉取最新等级！
        window.location.reload(); 
    } else {
        alert("切换失败: " + error.message);
    }
  };

  if (!profile) return <div className="p-10 text-center">加载中...</div>;

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-8">
      <h1 className="text-3xl font-black text-gray-900">个人中心</h1>

      {/* 套餐管理卡片 */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-6 border-b border-gray-50 flex justify-between items-center">
          <div>
            <h2 className="text-lg font-bold text-gray-800">当前套餐</h2>
            <p className="text-sm text-gray-400">管理您的订阅权限和额度</p>
          </div>
          <span className={`px-4 py-1 rounded-full text-xs font-black uppercase tracking-widest ${
            profile.tier === 'pro' ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600'
          }`}>
            {profile.tier}
          </span>
        </div>
        
        <div className="p-6 space-y-4">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">有效期至</span>
            <span className="font-medium">
              {profile.plan_expires_at ? new Date(profile.plan_expires_at).toLocaleDateString() : '永久有效'}
            </span>
          </div>
          
          <div className="pt-4 flex gap-4">
            <button 
              onClick={toggleTier}
              className="flex-1 py-3 bg-gray-900 text-white rounded-xl font-bold hover:bg-black transition-all"
            >
              切换至 {profile.tier === 'basic' ? 'Pro' : 'Basic'} (测试专用)
            </button>
          </div>
        </div>
      </div>

      {/* 账号安全卡片 */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-6">
        <h2 className="text-lg font-bold text-gray-800">安全设置</h2>
        
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-500">账户邮箱</label>
          <input 
            type="text" 
            disabled 
            value={user.email} 
            className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl text-gray-400"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-500">修改新密码</label>
          <div className="flex gap-3">
            <input 
              type="password" 
              placeholder="输入新密码"
              className="flex-1 p-3 border border-gray-200 rounded-xl outline-none focus:border-blue-500"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <button 
              onClick={handleUpdatePassword}
              disabled={isUpdating || !newPassword}
              className="px-6 py-3 bg-blue-600 text-white rounded-xl font-bold disabled:opacity-50"
            >
              更新
            </button>
          </div>
        </div>
      </div>

      {/* 快捷退出 */}
      <div className="text-center">
        <button 
          onClick={() => supabase.auth.signOut()}
          className="text-sm text-red-400 hover:text-red-600 font-medium"
        >
          安全退出登录
        </button>
      </div>
    </div>
  );
}