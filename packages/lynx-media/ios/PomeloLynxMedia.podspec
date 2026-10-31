Pod::Spec.new do |s|
  s.name = 'PomeloLynxMedia'
  s.version = '0.1.0'
  s.summary = 'Pomelo Lynx audio/video media native library'
  s.homepage = 'https://github.com/rangdl/pomelo-lynx'
  s.license = { :type => 'Apache-2.0' }
  s.author = 'Pomelo'
  s.platform = :ios, '15.0'
  s.source = { :path => '.' }
  s.swift_version = '5.0'
  s.default_subspecs = ['Audio']

  s.subspec 'Audio' do |a|
    a.source_files = 'src/**/*.swift'
    a.dependency 'Lynx', :modular_headers => true
  end

  # Video/MPV subspecs will be added when their sources land. Keeping the
  # Audio subspec as default means `pod 'PomeloLynxMedia'` is audio-only.
end
