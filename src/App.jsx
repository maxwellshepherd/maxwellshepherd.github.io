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
              href="/resume-784acda1c09a1b7d.pdf"
              target="_blank"
              rel="noopener noreferrer nofollow"
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
            <div className="space-y-4">
              <h1 className="text-6xl font-light text-black leading-tight">
                <span className="font-bold">Maxwell</span> Shepherd
              </h1>
              <p className="text-xl text-blue-600">
                Data Scientist &middot; Industrial Engineer
              </p>
            </div>

            <div className="space-y-5 text-gray-700 leading-relaxed text-lg">
              <p>
                I'm a data scientist and industrial engineer with an M.S. in Data Science
                from Johns Hopkins University, specializing in machine learning and artificial
                intelligence.
              </p>

              <p>
                At Boeing, I serve as an Industrial Engineer and Data Scientist,
                leading cross-functional teams that build end-to-end machine learning and statistical
                modeling solutions across multi-terabyte datasets. I'm also a{" "}
                <span className="text-gray-900 font-medium">Boeing Designated Expert in Analytics</span>,
                recognized as an enterprise-wide authority on business statistics, ML/GenAI, and
                analytics for an organization of 2,000+.
              </p>

              <p>
                My work spans the full data lifecycle: architecting ETL pipelines processing
                450M+ rows daily, building self-serve dashboards and full-stack analysis tools,
                and integrating agentic AI systems including LLM-powered automation.
              </p>

              <p>
                Before my current role, I supported process optimization and data automation
                across Boeing's 747, 767, 777X, and 787 programs, and held engineering
                internships at Disney and PTC&nbsp;Inc. I graduated from Purdue University
                in 2020 with a B.S. in Industrial Engineering. Outside of work, I'm a
                contributing author on{" "}
                <a
                  href="https://www.nature.com/articles/s41586-025-09962-4"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-700 transition-colors underline decoration-blue-300"
                >
                  a benchmark published in <em>Nature</em>
                </a>{" "}
                assessing AI capabilities on expert-level academic questions.
              </p>

              <p className="pt-2">
                For more on my technical skills and experience, see my{" "}
                <a
                  href="/resume-784acda1c09a1b7d.pdf"
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="text-blue-600 hover:text-blue-700 transition-colors underline decoration-blue-300"
                >
                  resume
                </a>.
              </p>
            </div>
          </div>

          {/* Right Content Profile Image */}
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
