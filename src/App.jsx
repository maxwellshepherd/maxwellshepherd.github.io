import profilePhoto from './assets/2025-07-05 07.27.23-1.jpg'

function App() {
  return (
    <div className="min-h-screen bg-white">
      {/* Header Navigation */}
      <header className="py-8">
        <div className="max-w-6xl mx-auto flex justify-end items-center px-8">
          <nav className="flex space-x-8">
            <a 
              href="#about" 
              className="text-purple-500 hover:text-purple-600 transition-colors text-sm"
            >
              about
            </a>
            <a 
              href="/Maxwell_Shepherd_Resume.pdf" 
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-600 hover:text-gray-800 transition-colors text-sm"
            >
              resume
            </a>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-8 py-16">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-16 items-start">
          {/* Left Content - Text */}
          <div className="lg:col-span-2 space-y-8">
            <div className="space-y-6">
              <h1 className="text-6xl font-light text-black leading-tight">
                <span className="font-bold">Maxwell</span> Shepherd
              </h1>
              <p className="text-xl text-blue-600">
                Industrial Engineer | Data Scientist
              </p>
            </div>

            <div className="space-y-6 text-gray-800 leading-relaxed text-lg">
              <p>
                I'm a <span className="font-semibold text-gray-900">data scientist</span> and{" "}
                <span className="font-semibold text-gray-900">industrial engineer</span> currently pursuing my{" "}
                <span className="font-semibold text-gray-900">M.S. in Data Science</span> at{" "}
                <span className="font-semibold text-gray-900">Johns Hopkins University</span>, 
                specializing in machine learning and artificial intelligence.
              </p>

              <p>
                At <span className="font-semibold text-gray-900">Boeing</span>, I work as an{" "}
                <span className="font-semibold text-gray-900">Industrial Engineer</span> and{" "}
                <span className="font-semibold text-gray-900">Data Scientist</span>, where I collaborate with 
                cross-functional engineering teams developing{" "}
                <span className="font-semibold text-gray-900">machine learning solutions</span> and 
                analytics tools for aircraft manufacturing and operations.
              </p>

              <p>
                My work focuses on enterprise-scale{" "}
                <span className="font-semibold text-gray-900">statistical analysis</span> and{" "}
                <span className="font-semibold text-gray-900">data visualization</span>, helping teams 
                interpret large datasets and make data-driven decisions. I specialize in{" "}
                <span className="font-semibold text-gray-900">AI integration</span> and have developed 
                widely-used analytics products that drive operational efficiency.
              </p>

              <p>
                Prior to my current role, I gained experience at{" "}
                <span className="font-semibold text-gray-900">Walt Disney World</span> supporting operations 
                through statistical analysis and simulation, and at{" "}
                <span className="font-semibold text-gray-900">PTC Inc.</span> working on 
                manufacturing technology optimization.
              </p>

              <p>
                I graduated from <span className="font-semibold text-gray-900">Purdue University's College of Engineering</span>{" "}
                in 2020 with my B.S. in Industrial Engineering.
              </p>

              <p className="pt-4">
                For more detailed information on my technical skills and experience, please see my{" "}
                <a 
                  href="/Maxwell_Shepherd_Resume.pdf" 
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-700 transition-colors font-medium underline"
                >
                  resume
                </a>.
              </p>
            </div>
          </div>

          {/* Right Content - Profile Image */}
          <div className="lg:col-span-1 flex flex-col items-center space-y-4">
            <div className="w-full">
              <img
                src={profilePhoto}
                alt="Maxwell Shepherd"
                className="w-full h-auto rounded-lg shadow-lg object-cover"
              />
            </div>
            <p className="text-gray-500 text-sm">hi</p>
          </div>
        </div>
      </main>
    </div>
  )
}

export default App
